#!/usr/bin/env bash
# Dev (invocato da cargo watch a ogni modifica): su Windows il kill del
# processo padre da parte di cargo watch lascia in vita il server, il cui
# exe resta bloccato e impedisce la ricompilazione. Lo uccidiamo qui prima
# di buildare e rilanciare.
taskkill //IM mosaikit-server.exe //F >/dev/null 2>&1
exec cargo run
