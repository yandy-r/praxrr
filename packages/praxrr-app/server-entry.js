// Praxrr server entry for the @sveltejs/adapter-node build.
//
// The build copies this file next to the adapter output (dist/build/server-entry.js) and
// `deno compile` uses it as the binary's entry point. It only sets Praxrr's defaults for
// adapter-node's documented environment variables, then starts adapter-node's own server
// (./index.js) unchanged. Any variable an operator sets explicitly still wins, except the two
// client-address overrides below.
import process from 'node:process';

const env = process.env;

// Praxrr derives client addresses and forwarded headers itself (TRUSTED_PROXY, see
// src/lib/server/utils/auth/network.ts), so event.getClientAddress() must always be the socket
// peer. adapter-node would otherwise trust these headers from any client.
for (const name of ['ADDRESS_HEADER', 'XFF_DEPTH']) {
  if (name in env) {
    console.warn(`[praxrr] Ignoring ${name}: configure TRUSTED_PROXY instead.`);
    delete env[name];
  }
}

// adapter-node trusts these from any client; TRUSTED_PROXY is the supported way to honour a proxy.
for (const name of ['PROTOCOL_HEADER', 'HOST_HEADER', 'PORT_HEADER']) {
  if (env[name]) {
    console.warn(`[praxrr] ${name} is set: adapter-node trusts it from every client.`);
  }
}

// Same listen port as the Docker image and the app's own config default.
env.PORT ??= '6868';
// adapter-node defaults to 512K; backup restore accepts archives up to 1 GiB.
env.BODY_SIZE_LIMIT ??= '1100M';
// adapter-node waits up to 30s for open requests (live-event streams never finish), which
// outlasts `docker stop`'s 10s grace period.
env.SHUTDOWN_TIMEOUT ??= '5';

// Without ORIGIN or PROTOCOL_HEADER, adapter-node assumes every request is https. Praxrr serves
// plain http directly and resolves proxied schemes itself, so report the socket's real protocol
// through a private header that is overwritten on every request (clients cannot spoof it).
const SOCKET_PROTOCOL_HEADER = 'x-praxrr-socket-protocol';
const useSocketProtocol = !env.ORIGIN && !env.PROTOCOL_HEADER;
if (useSocketProtocol) {
  env.PROTOCOL_HEADER = SOCKET_PROTOCOL_HEADER;
}

const { server } = await import('./index.js');

if (useSocketProtocol) {
  server.prependListener('request', (req) => {
    req.headers[SOCKET_PROTOCOL_HEADER] = req.socket.encrypted ? 'https' : 'http';
  });
}

// adapter-node stops accepting requests on SIGTERM/SIGINT and emits this once the server has
// closed; background jobs keep timers alive, so exit explicitly.
process.on('sveltekit:shutdown', () => process.exit(0));
