#!/bin/sh
set -e
npm ci
exec "$@"
