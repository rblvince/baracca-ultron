#!/bin/bash
# Opens a Terminal Ultron session. Only one session may listen on Discord:
# if one is already up, this one starts without --channels.
cd "$HOME/my-agent"
if pgrep -f -- "--channels plugin:discord" >/dev/null; then
  exec claude
else
  exec claude --channels plugin:discord@claude-plugins-official
fi
