FROM oven/bun:1-debian

RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates curl \
	&& rm -rf /var/lib/apt/lists/*

# The relay drives Amp through its CLI, authenticated by the AMP_API_KEY secret.
ENV AMP_HOME=/opt/amp PATH=/opt/amp/bin:$PATH
RUN curl -fsSL https://ampcode.com/install.sh | bash && amp --version

WORKDIR /app
COPY package.json tsconfig.json ./
COPY src ./src

ENV PORT=8080 STATE_FILE=/data/state.json
EXPOSE 8080
CMD ["bun", "src/server.ts"]
