---
name: finding-implicit-state-machines
description: "Finds implicit state machines in Rust code (coupled bool or Option fields, unowned tasks, timers, or sockets, and racing async completions) and refactors them into algebraic State, Event, and Effect enums with pure functional transitions and centralized transition logging. Use when asked to find implicit state machines, when debugging flaky lifecycle bugs (stuck states, double-fires, dropped connections, stale async completions), or before changing stateful async flows such as reconnecting, failover, streaming, or session management. Not for stateless transforms or independent flags that hold no shared invariants."
---

# Finding Implicit State Machines

Turn fragmented lifecycle state into a functional core with a thin imperative shell: model legal states as an algebraic `enum State`, inputs as past-tense `enum Event` facts, side effects as plain `enum Effect` data, and state changes as a pure `transition(state, event)` function whose moves are logged in one place.

## Spot an Implicit State Machine

- **Coupled fields**: Two or more `bool`, `Option<T>`, `AtomicBool`, or `Arc<Mutex<Option<...>>>` fields on a struct that must stay consistent (such as `connected: bool`, `reconnecting: bool`, `socket: Option<WsStream>`, and `in_flight: Option<RequestId>`). Ask whether each combination is valid; if the answer needs reasoning or a comment like `// Some only when connected`, one state machine is split across separate fields.
- **Scattered writes**: A flag or `Option` written or cleared in several methods, `match` arms, or `tokio::select!` branches. List every write site; each write is an unnamed transition.
- **Silent guards**: Checks such as `if self.active && !self.draining`, `if self.busy.swap(true, Ordering::AcqRel) { return; }`, or `let Some(conn) = &self.conn else { return; };`. These are transitions that are legal in some states and silently dropped in others.
- **Unowned resources**: `JoinHandle`, `AbortHandle`, `CancellationToken`, `Sleep` or `Interval` timers, sockets, channels, or `Child` processes kept in struct fields, `OnceLock` statics, or detached `tokio::spawn` tasks with no state variant that owns their lifetime. Trace every exit path (error, timeout, cancellation, reconnect, shutdown) and check what aborts or drops each resource.
- **Racing async completions**: An `.await` or channel receive followed by mutating shared state—especially re-acquiring a `Mutex` or `RwLock` after `.await`, or holding `&mut self` across `.await`—without checking a monotonic attempt or generation ID. Stale replies, late socket closes, and backoff timers that fire after cancellation corrupt newer state.
- **Wildcard matches and dead ends**: A `match` on a status string, integer, or `enum` with a `_ => {}` arm that silently drops unhandled cases and newly added variants, or a state that no transition leaves.
- **Hidden background writers**: `watch::Receiver` or `broadcast::Receiver` tasks, callbacks, `Drop` impls, or spawned tasks that mutate shared `Arc<Mutex<...>>` or atomics outside the main state owner.

## Report and Prove Before Refactoring

Unless the user asks to skip the audit and refactor immediately, report every implicit state machine before editing production code. Include the following for each machine:

- **Location**: file paths, structs, tasks, and the fragmented fields or resource handles.
- **States**: explicit or inferred states, plus the data valid only in each state.
- **Events**: every external command, async completion, timer expiry, error, or cancellation that drives changes.
- **Transition table**: each `from --event--> to` edge, calling out silent drops, dead ends, and unguarded writes.
- **Reachable bugs and races**: each illegal combination, leaked handle, or async race as a concrete sequence of steps, ranked by user-visible harm (stuck session, duplicate side effects, dropped work, leaked tasks or sockets).
- **Proof**: reproduce each reported bug with a deterministic failing `#[test]` or `#[tokio::test]` (using channels or `tokio::time::pause()`, never wall-clock sleeps) before calling it confirmed. Mark any suspected issue that you have not reproduced as unverified.

## Refactor into a Functional Core and Imperative Shell

- **Encode legal states as an algebraic `enum State`**: Put each piece of data only in the variant where it is valid (`Idle`, `Connecting`, `Connected`, `BackingOff`). Derive `Debug, Clone, PartialEq, Eq` so pure tests can compare states directly. Keep non-cloneable I/O handles (`TcpStream`, `JoinHandle`, `AbortHandle`) in the shell rather than inside `State` so the core needs no async runtime. Default to a runtime `enum State` for async and event-driven flows; use compile-time typestate (`Session<Connecting>` -> `Session<Connected>`) only for strictly linear, caller-driven protocols where the caller knows the next state statically.
- **Name `enum Event` variants as facts**: Use past-tense facts (`ConnectRequested`, `SocketOpened`, `SocketFailed`, `SocketClosed`, `BackoffElapsed`, `DisconnectRequested`), never imperative setters (`SetConnected(bool)`). Carry timestamps (`now: Duration` elapsed since a monotonic origin) and monotonic `AttemptId` values on the event so transitions never read the clock or global counters.
- **Write a pure `transition(state: State, event: Event) -> Transition`**: Consume `state` by value and return `Transition { state, effects, outcome }`. Moving `state` by value ensures atomic replacement with no half-mutated fields and no `unwrap()`. Perform no I/O, locking, spawning, randomness, or `Instant::now()` calls inside `transition`.
- **Keep `match` arms exhaustive**: Match `(state, event)` without `_` wildcards—listing ignored event variants explicitly per state—so adding a new `State` or `Event` variant causes a compile error at every transition table. Never panic on an event that the current state does not handle; return `state` unchanged with no effects and an `Ignored` or `Stale` outcome.
- **Emit side effects as plain `enum Effect` data**: Derive `Debug, Clone, PartialEq, Eq`. Every socket, timer, or task belongs to a specific `AttemptId` and state, and every transition out of that state emits an explicit teardown effect (`CancelConnect`, `CancelBackoff`, `CloseSocket`).
- **Advance `AttemptId` monotonically and filter stale events once**: Retain `last_attempt` in `Idle` instead of resetting to zero so a delayed completion from a cancelled session cannot match a new session's first attempt. Check `event.attempt()` against `state.active_attempt()` at the top of `transition` and drop mismatches as `Outcome::Stale`.
- **Log every transition in one place**: Wrap `transition` in a single `step` function that records `from` and `to` names and emits one structured log line per event (`machine from --event--> to`, tagging `(ignored)` and `(stale)` outcomes explicitly).
- **Run effects in a thin imperative shell**: One event loop owns the current `State`, an `mpsc::Receiver<Event>`, and live handles keyed by `AttemptId`. Each spawned task tags its outcome event with the `AttemptId` that started it and sends it back over `mpsc::Sender<Event>`. Teardown effects abort or drop the matching handle immediately, and `Drop` on the handle container aborts active tasks when the loop exits.
- **Avoid state-machine crates unless they pay for themselves**: Plain enums and exhaustive `match` arms are simpler and clearer to `rust-analyzer` than proc-macro DSL crates. Reach for a library only when you genuinely need hierarchical or orthogonal states or generated charts that teammates will read.
- **Migrate every caller and delete old flags in the same change**: Route all callers and background tasks through `Event`s and remove the old `bool`s, `Option`s, atomics, and guards together. Keeping old flags synchronized alongside `State` reintroduces drift.

## Functional Rust Example

### Pure core (`transition` and centralized `step` logger)

```rust
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct AttemptId(u64);

impl AttemptId {
    pub const ZERO: Self = Self(0);
    pub fn next(self) -> Self { Self(self.0 + 1) }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SessionId(u64);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum State {
    Idle { last_attempt: AttemptId },
    Connecting { attempt: AttemptId, started_at: Duration },
    Connected { attempt: AttemptId, session_id: SessionId },
    BackingOff { attempt: AttemptId, retry_at: Duration },
}

impl State {
    pub fn name(&self) -> &'static str {
        match self {
            State::Idle { .. } => "Idle",
            State::Connecting { .. } => "Connecting",
            State::Connected { .. } => "Connected",
            State::BackingOff { .. } => "BackingOff",
        }
    }

    pub fn active_attempt(&self) -> Option<AttemptId> {
        match self {
            State::Idle { .. } => None,
            State::Connecting { attempt, .. }
            | State::Connected { attempt, .. }
            | State::BackingOff { attempt, .. } => Some(*attempt),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    ConnectRequested { now: Duration },
    SocketOpened { attempt: AttemptId, session_id: SessionId },
    SocketFailed { attempt: AttemptId, now: Duration, backoff: Duration },
    SocketClosed { attempt: AttemptId, now: Duration, backoff: Duration },
    BackoffElapsed { attempt: AttemptId, now: Duration },
    DisconnectRequested,
}

impl Event {
    pub fn attempt(&self) -> Option<AttemptId> {
        match self {
            Event::SocketOpened { attempt, .. }
            | Event::SocketFailed { attempt, .. }
            | Event::SocketClosed { attempt, .. }
            | Event::BackoffElapsed { attempt, .. } => Some(*attempt),
            Event::ConnectRequested { .. } | Event::DisconnectRequested => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Effect {
    OpenSocket { attempt: AttemptId },
    CancelConnect { attempt: AttemptId },
    CloseSocket { attempt: AttemptId },
    StartBackoff { attempt: AttemptId, delay: Duration },
    CancelBackoff { attempt: AttemptId },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome { Moved, Ignored, Stale }

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Transition {
    pub state: State,
    pub effects: Vec<Effect>,
    pub outcome: Outcome,
}

impl Transition {
    fn to(state: State, effects: Vec<Effect>) -> Self {
        Self { state, effects, outcome: Outcome::Moved }
    }
    fn ignored(state: State) -> Self {
        Self { state, effects: Vec::new(), outcome: Outcome::Ignored }
    }
    fn stale(state: State) -> Self {
        Self { state, effects: Vec::new(), outcome: Outcome::Stale }
    }
}

pub fn transition(state: State, event: Event) -> Transition {
    if let Some(ev_attempt) = event.attempt() {
        if state.active_attempt() != Some(ev_attempt) {
            return Transition::stale(state);
        }
    }
    match (state, event) {
        (State::Idle { last_attempt }, Event::ConnectRequested { now }) => {
            let attempt = last_attempt.next();
            Transition::to(
                State::Connecting { attempt, started_at: now },
                vec![Effect::OpenSocket { attempt }],
            )
        }
        (State::Connecting { attempt, .. }, Event::SocketOpened { session_id, .. }) => {
            Transition::to(State::Connected { attempt, session_id }, vec![])
        }
        (State::Connecting { attempt, .. }, Event::SocketFailed { now, backoff, .. }) => {
            Transition::to(
                State::BackingOff { attempt, retry_at: now.saturating_add(backoff) },
                vec![Effect::StartBackoff { attempt, delay: backoff }],
            )
        }
        (State::Connecting { attempt, .. }, Event::DisconnectRequested) => Transition::to(
            State::Idle { last_attempt: attempt },
            vec![Effect::CancelConnect { attempt }],
        ),
        (State::Connected { attempt, .. }, Event::SocketClosed { now, backoff, .. }) => {
            Transition::to(
                State::BackingOff { attempt, retry_at: now.saturating_add(backoff) },
                vec![
                    Effect::CloseSocket { attempt },
                    Effect::StartBackoff { attempt, delay: backoff },
                ],
            )
        }
        (State::Connected { attempt, .. }, Event::DisconnectRequested) => Transition::to(
            State::Idle { last_attempt: attempt },
            vec![Effect::CloseSocket { attempt }],
        ),
        (State::BackingOff { attempt, .. }, Event::BackoffElapsed { now, .. }) => {
            let next = attempt.next();
            Transition::to(
                State::Connecting { attempt: next, started_at: now },
                vec![Effect::OpenSocket { attempt: next }],
            )
        }
        (State::BackingOff { attempt, .. }, Event::DisconnectRequested) => Transition::to(
            State::Idle { last_attempt: attempt },
            vec![Effect::CancelBackoff { attempt }],
        ),
        // List ignored pairs explicitly (no `_` wildcard) so new State or Event variants fail to compile.
        (
            state @ State::Idle { .. },
            Event::DisconnectRequested
            | Event::SocketOpened { .. }
            | Event::SocketFailed { .. }
            | Event::SocketClosed { .. }
            | Event::BackoffElapsed { .. },
        )
        | (
            state @ State::Connecting { .. },
            Event::ConnectRequested { .. }
            | Event::SocketClosed { .. }
            | Event::BackoffElapsed { .. },
        )
        | (
            state @ State::Connected { .. },
            Event::ConnectRequested { .. }
            | Event::SocketOpened { .. }
            | Event::SocketFailed { .. }
            | Event::BackoffElapsed { .. },
        )
        | (
            state @ State::BackingOff { .. },
            Event::ConnectRequested { .. }
            | Event::SocketOpened { .. }
            | Event::SocketFailed { .. }
            | Event::SocketClosed { .. },
        ) => Transition::ignored(state),
    }
}

pub fn step(state: State, event: Event, mut log: impl FnMut(&str)) -> (State, Vec<Effect>) {
    let from = state.name();
    let ev = format!("{event:?}");
    let tr = transition(state, event);
    let to = tr.state.name();
    match tr.outcome {
        Outcome::Moved => log(&format!("session {from} --{ev}--> {to}")),
        Outcome::Ignored => log(&format!("session {from} --{ev} (ignored)--> {to}")),
        Outcome::Stale => log(&format!("session {from} --{ev} (stale)--> {to}")),
    }
    (tr.state, tr.effects)
}
```

### Thin imperative shell

Keep live sockets and `AbortHandle`s in the shell so `State`, `Event`, and `Effect` remain plain value types. Abort active handles both on teardown effects and on `Drop`:

```rust
#[derive(Default)]
struct ShellHandles {
    socket: Option<(AttemptId, AbortHandle)>,
    backoff: Option<(AttemptId, AbortHandle)>,
}

impl ShellHandles {
    fn abort_if(slot: &mut Option<(AttemptId, AbortHandle)>, attempt: AttemptId) {
        if slot.as_ref().is_some_and(|(id, _)| *id == attempt) {
            if let Some((_, handle)) = slot.take() {
                handle.abort();
            }
        }
    }
}

impl Drop for ShellHandles {
    fn drop(&mut self) {
        if let Some((_, h)) = self.socket.take() { h.abort(); }
        if let Some((_, h)) = self.backoff.take() { h.abort(); }
    }
}

async fn run_session(mut rx: mpsc::Receiver<Event>, tx: mpsc::Sender<Event>, origin: Instant) {
    let mut state = State::Idle { last_attempt: AttemptId::ZERO };
    let mut handles = ShellHandles::default();

    while let Some(event) = rx.recv().await {
        let (next, effects) = step(state, event, |msg| tracing::debug!("{msg}"));
        state = next;
        for effect in effects {
            match effect {
                Effect::OpenSocket { attempt } => {
                    let tx = tx.clone();
                    let task = tokio::spawn(async move {
                        drive_socket(attempt, origin, tx).await;
                    });
                    if let Some((_, prev)) = handles.socket.replace((attempt, task.abort_handle())) {
                        prev.abort();
                    }
                }
                Effect::CancelConnect { attempt } | Effect::CloseSocket { attempt } => {
                    ShellHandles::abort_if(&mut handles.socket, attempt);
                }
                Effect::StartBackoff { attempt, delay } => {
                    let tx = tx.clone();
                    let task = tokio::spawn(async move {
                        tokio::time::sleep(delay).await;
                        let _ = tx.send(Event::BackoffElapsed { attempt, now: origin.elapsed() }).await;
                    });
                    if let Some((_, prev)) = handles.backoff.replace((attempt, task.abort_handle())) {
                        prev.abort();
                    }
                }
                Effect::CancelBackoff { attempt } => {
                    ShellHandles::abort_if(&mut handles.backoff, attempt);
                }
            }
        }
    }
}
```

### Pure sequence tests with `Iterator::fold`

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn run(initial: State, events: impl IntoIterator<Item = Event>) -> (State, Vec<Effect>) {
        events.into_iter().fold((initial, Vec::new()), |(state, mut all), ev| {
            let tr = transition(state, ev);
            all.extend(tr.effects);
            (tr.state, all)
        })
    }

    #[test]
    fn stale_completion_after_cancel_and_reconnect_is_dropped() {
        let (state, effects) = run(
            State::Idle { last_attempt: AttemptId::ZERO },
            [
                Event::ConnectRequested { now: Duration::from_millis(10) },
                Event::DisconnectRequested,
                Event::ConnectRequested { now: Duration::from_millis(20) },
                Event::SocketOpened { attempt: AttemptId(1), session_id: SessionId(99) },
            ],
        );
        assert_eq!(
            state,
            State::Connecting { attempt: AttemptId(2), started_at: Duration::from_millis(20) }
        );
        assert_eq!(
            effects,
            vec![
                Effect::OpenSocket { attempt: AttemptId(1) },
                Effect::CancelConnect { attempt: AttemptId(1) },
                Effect::OpenSocket { attempt: AttemptId(2) },
            ]
        );
    }

    #[test]
    fn failure_backs_off_then_retries_with_next_attempt() {
        let delay = Duration::from_millis(500);
        let (state, effects) = run(
            State::Idle { last_attempt: AttemptId::ZERO },
            [
                Event::ConnectRequested { now: Duration::ZERO },
                Event::SocketFailed { attempt: AttemptId(1), now: Duration::from_millis(100), backoff: delay },
                Event::BackoffElapsed { attempt: AttemptId(1), now: Duration::from_millis(600) },
                Event::SocketOpened { attempt: AttemptId(2), session_id: SessionId(7) },
            ],
        );
        assert_eq!(state, State::Connected { attempt: AttemptId(2), session_id: SessionId(7) });
        assert_eq!(
            effects,
            vec![
                Effect::OpenSocket { attempt: AttemptId(1) },
                Effect::StartBackoff { attempt: AttemptId(1), delay },
                Effect::OpenSocket { attempt: AttemptId(2) },
            ]
        );
    }
}
```

## Test and Model Costly Races

- Test the pure core by folding event sequences through `transition` and asserting both the final `State` and the full `Vec<Effect>`: happy path, cancellation mid-flight, stale completions arriving after cancel and reconnect, failure with backoff or failover, and duplicate or out-of-order events.
- Add one thin integration test for the shell that verifies teardown effects abort live tasks and that real async completions return with the right `AttemptId`.
- For high-stakes concurrency or distributed races (failover, leader election, multi-task coordination), fuzz arbitrary `Vec<Event>` sequences with `proptest` to check step-by-step invariants (for example, `AttemptId` never decreases, every teardown names an attempt that was started, and `DisconnectRequested` always reaches `Idle`), or model the protocol with `stateright` or TLA+. Replay every counterexample as a deterministic unit test against `transition`.

## Common Shortcuts to Avoid

- **Keeping old flags alongside `State`**: Delete legacy `bool` and `Option` fields in the same change and expose pure read helpers on `State` instead of trying to keep two representations synchronized.
- **Using `_ => Transition::ignored(state)`**: A catch-all wildcard stops the compiler from flagging missing transitions whenever someone adds a `State` or `Event` variant.
- **Resetting `AttemptId` to zero on `Idle`**: Resetting allows a late completion from a cancelled session to match the next session's first attempt.
- **Storing `JoinHandle` or sockets inside `State`**: Storing non-cloneable I/O handles inside `State` prevents `#[derive(Clone, PartialEq, Eq)]` and forces async mocks into unit tests.
- **Reading `Instant::now()` or randomness inside `transition`**: Pass elapsed `Duration` and backoff values on `Event` so that event sequences replay deterministically.
