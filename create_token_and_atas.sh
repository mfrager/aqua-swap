#!/usr/bin/env bash
# ----------------------------------------------------------------------
# Script to:
#   1. Create a new SPL token (mint).
#   2. Create an ATA for the wallet (default keypair) for the new token.
#   3. Create an ATA for the wallet for a given quote mint.
#   4. Create an ATA for the new token for a recipient.
#   5. Mint 1,000 tokens (adjusted for decimals) into the recipient ATA.
#
# Requirements:
#   - solana CLI configured
#   - spl-token CLI v3.x
# ----------------------------------------------------------------------

set -euo pipefail

# ------------------ Configuration ------------------

# Fee payer keypair file
FEE_PAYER_KEYPAIR="${FEE_PAYER_KEYPAIR:-$HOME/.config/solana/id.json}"

# ------------------ Helper Functions ------------------

print_usage() {
    echo "Usage: $0 --quote-mint <QUOTE_MINT_ADDRESS> [--recipient <RECIPIENT_ADDRESS>] [--decimals <DECIMALS>]"
    exit 1
}

get_or_create_ata() {
    local mint="$1"
    local owner="$2"

    # derive ATA
    local ata
    ata=$(spl-token address --verbose --token "$mint" --owner "$owner" 2>/dev/null | tail -n1 | tr -d '[:space:]')

    # check if it exists
    if solana account "$ata" >/dev/null 2>&1; then
        echo "$ata"
        return
    fi

    # create ATA if missing
    echo "Creating ATA for owner $owner and mint $mint..."
    spl-token create-account "$mint" --owner "$owner" --fee-payer "$FEE_PAYER_KEYPAIR" >/dev/null
    echo "$ata"
}

# ------------------ Parse arguments ------------------

QUOTE_MINT=""
RECIPIENT=""
DECIMALS=9

while [[ $# -gt 0 ]]; do
    case "$1" in
        --quote-mint)
            QUOTE_MINT="$2"; shift 2 ;;
        --recipient)
            RECIPIENT="$2"; shift 2 ;;
        --decimals)
            DECIMALS="$2"; shift 2 ;;
        -h|--help)
            print_usage ;;
        *)
            echo "Unknown option: $1"
            print_usage ;;
    esac
done

if [[ -z "$QUOTE_MINT" ]]; then
    echo "Error: --quote-mint is required."
    print_usage
fi

MAIN_WALLET=$(solana address)

if [[ -z "$RECIPIENT" ]]; then
    RECIPIENT="$MAIN_WALLET"
fi

echo "Main wallet: $MAIN_WALLET"
echo "Recipient  : $RECIPIENT"
echo "Quote mint : $QUOTE_MINT"
echo "Decimals   : $DECIMALS"
echo "Fee payer  : $FEE_PAYER_KEYPAIR"

# ------------------ Main Logic ------------------

# 1. Create new token (mint)
echo "Creating new token..."
NEW_TOKEN_MINT=$(spl-token create-token --decimals "$DECIMALS" --fee-payer "$FEE_PAYER_KEYPAIR" | awk '/Creating token/ {print $3}')
echo "New token mint: $NEW_TOKEN_MINT"

# 2. Create ATA for main wallet for the new token
echo "Ensuring ATA for main wallet for new token..."
MAIN_ATA=$(get_or_create_ata "$NEW_TOKEN_MINT" "$MAIN_WALLET")
echo "Main ATA: $MAIN_ATA"

# 3. Create ATA for main wallet for the quote mint
echo "Ensuring ATA for main wallet for quote mint..."
QUOTE_ATA=$(get_or_create_ata "$QUOTE_MINT" "$MAIN_WALLET")
echo "Quote ATA: $QUOTE_ATA"

# 4. Create ATA for recipient for the new token
echo "Ensuring ATA for recipient for new token..."
RECIPIENT_ATA=$(get_or_create_ata "$NEW_TOKEN_MINT" "$RECIPIENT")
echo "Recipient ATA: $RECIPIENT_ATA"

# 5. Mint 1,000 tokens (adjusted for decimals) into recipient ATA
MINT_AMOUNT=$((1000 * 10**DECIMALS))
echo "Minting $MINT_AMOUNT (1000 tokens with $DECIMALS decimals) to $RECIPIENT_ATA..."
spl-token mint "$NEW_TOKEN_MINT" "$MINT_AMOUNT" "$RECIPIENT_ATA" --fee-payer "$FEE_PAYER_KEYPAIR"

echo "✅ Done!"
echo "New token mint: $NEW_TOKEN_MINT"
echo "Main ATA:       $MAIN_ATA"
echo "Quote ATA:      $QUOTE_ATA"
echo "Recipient ATA:  $RECIPIENT_ATA"

