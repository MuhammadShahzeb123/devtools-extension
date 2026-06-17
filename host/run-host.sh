#!/bin/sh
exec node "$(dirname "$0")/host.js" 2>>"$(dirname "$0")/host.log"
