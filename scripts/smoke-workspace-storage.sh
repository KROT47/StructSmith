#!/usr/bin/env bash
set -euo pipefail

image=${1:?Pass the StructSmith image tag}
prefix="structsmith-workspaces-$(date +%s)-$$"
server="$prefix-server"
contender="$prefix-contender"
workspaces=$(mktemp -d "$(cd /tmp && pwd -P)/structsmith-workspaces.XXXXXXXX")
data="$prefix-data"
other_data="$prefix-other-data"

cleanup() {
  docker rm -f "$server" "$contender" >/dev/null 2>&1 || true
  docker volume rm "$data" "$other_data" >/dev/null 2>&1 || true
  rm -rf -- "$workspaces"
}
trap cleanup EXIT

# The container runs as a different UID on some hosts.
chmod a+rwx "$workspaces"

run_server() {
  docker run -d --name "$1" -e WORKSPACE_FILES_DIR=/workspaces -e AGENT_CHAT_ENABLED=false \
    --mount "type=bind,source=$workspaces,target=/workspaces" -v "$2:/data" "$image"
}

request() {
  docker exec "$server" bun -e '
    const [path, body] = process.argv.slice(1);
    const response = await fetch("http://127.0.0.1:8080" + path, body && {
      method: "POST", body, headers: { "content-type": "application/json" }
    });
    if (response.status !== (body ? 201 : 200)) process.exit(1);
    console.log(await response.text());
  ' -- "$@"
}

wait_for_health() {
  for ((attempt=0; attempt<30; attempt++)); do
    if request /health >/dev/null 2>&1; then
      return
    fi
    sleep 1
  done
  docker logs "$server"
  return 1
}

check_workspace() {
  request /api/workspaces/storage-smoke | grep -F '"name":"Storage smoke"'
  check_workspace_files storage-smoke.json
}

check_workspace_files() {
  if [ "$(ls -1A "$workspaces")" != "$1" ]; then
    echo "Unexpected contents in the host workspace directory (expected: ${1:-empty})" >&2
    ls -la "$workspaces" >&2
    return 1
  fi
}

run_server "$server" "$data"
wait_for_health
request /api/workspaces | grep -Fx '{"workspaces":[]}'
check_workspace_files ''
request /api/workspaces '{"id":"storage-smoke","name":"Storage smoke"}'
for ((attempt=0; attempt<30; attempt++)); do
  if [ -s "$workspaces/storage-smoke.json" ]; then
    break
  fi
  sleep 1
done
test -s "$workspaces/storage-smoke.json"
check_workspace_files storage-smoke.json

docker stop "$server"
test "$(docker wait "$server")" = 0
docker start "$server"
wait_for_health
check_workspace

docker kill --signal KILL "$server"
test "$(docker wait "$server")" = 137
docker start "$server"
wait_for_health
check_workspace

run_server "$contender" "$other_data"
for ((attempt=0; attempt<15; attempt++)); do
  if [ "$(docker inspect -f '{{.State.Status}}' "$contender")" = exited ]; then
    break
  fi
  sleep 1
done
test "$(docker inspect -f '{{.State.ExitCode}}' "$contender")" = 1
docker logs "$contender" 2>&1 | grep -F 'Workspace directory is already in use'
wait_for_health
check_workspace
echo "Workspace storage smoke test passed."
