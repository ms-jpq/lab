#!/bin/sh

set -eu

# shellcheck disable=2154
ipfs config --json API.HTTPHeaders.Access-Control-Allow-Origin "[\"https://$ENV_CORS_DOMAIN\"]"
ipfs config --json API.HTTPHeaders.Access-Control-Allow-Methods '["PUT", "POST"]'
