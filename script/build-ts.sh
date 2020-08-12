#!/bin/sh

set -e

rollup -c ../../rollup.config.js -n $(node -p "require('./package.json').name")
