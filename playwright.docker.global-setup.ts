import { rmSync } from 'node:fs';

// Wipe a leftover magic-link capture file from a previous run before the
// container starts, so a stale entry can't be picked up as "latest". The
// `.e2e-docker` directory itself is a bind mount declared in compose.e2e.yaml
// and does not need to be pre-created — Docker creates missing bind-mount
// directories on its own.
export default async function globalSetup() {
	rmSync('./.e2e-docker/magic-link.log', { force: true });
}
