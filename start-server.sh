#!/bin/bash
pkill -f 'node server.js' || true
sleep 1
cd /Users/flippi/Developer/fotoflip
nohup /usr/local/bin/node server.js > /tmp/fotoflip.log 2>&1 &
