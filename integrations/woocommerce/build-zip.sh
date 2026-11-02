#!/bin/sh
# Packs the plugin folder into public/downloads/crypteo-for-woocommerce.zip.
set -eu
cd "$(dirname "$0")"
out="$(cd ../.. && pwd)/public/downloads/crypteo-for-woocommerce.zip"
mkdir -p "$(dirname "$out")"
rm -f "$out"
zip -rqX "$out" crypteo-for-woocommerce -x '*.DS_Store'
echo "$out"
