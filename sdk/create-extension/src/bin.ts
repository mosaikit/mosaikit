#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { main } from './cli.js';

process.exit(main(process.argv.slice(2)));
