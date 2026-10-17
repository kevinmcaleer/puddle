#!/bin/sh
# Run by the nginx image's entrypoint before nginx starts. The taxi tutorial's pass-through (deploy/nginx.conf) looks
# up the TLC's host when a request comes, so nginx needs to be told which DNS servers to ask: the container's own,
# from /etc/resolv.conf (IPv6 ones in brackets). /tmp is writable even with a read-only root file system.
set -eu
servers=$(awk '/^nameserver/ { s = $2; if (index(s, ":")) s = "[" s "]"; printf "%s ", s }' /etc/resolv.conf)
echo "resolver ${servers:-127.0.0.11} valid=60s ipv6=off;" > /tmp/puddle-resolver.conf
