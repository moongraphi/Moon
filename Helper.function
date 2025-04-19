const { Connection, PublicKey, AccountInfo } = require('@solana/web3.js');
const { getMint } = require('@solana/spl-token');

const connection = new Connection('https://mainnet.helius-rpc.com/?api-key=' + process.env.HELIUS_API_KEY, { commitment: 'confirmed' });

async function extractTokenInfo(tx) {
  const tokenAddress = tx.tokenMint || tx.accounts?.[0] || tx.signature;
  if (!tokenAddress) return null;

  try {
    // Fetch metadata from Helius API
    const response = await fetch(
      `https://api.helius.xyz/v0/tokens/metadata?api-key=${process.env.HELIUS_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mintAccounts: [tokenAddress] })
      }
    );
    if (!response.ok) throw new Error(`Helius API error: ${response.status} - ${await response.text()}`);
    const data = await response.json();
    const metadata = data[0] || {};

    // Fetch additional data using Solana RPC
    const mintPublicKey = new PublicKey(tokenAddress);
    const mintInfo = await getMint(connection, mintPublicKey);
    const supply = mintInfo.supply.toNumber() / 10 ** mintInfo.decimals; // Total supply in tokens

    // Estimate liquidity and market cap (simplified, needs real pool data)
    const liquidity = metadata.liquidity || (supply * 0.01); // Assuming 1% of supply as liquidity
    const marketCap = metadata.marketCap || (supply * 0.000005); // Using launch price as base

    console.log('Fetched token data:', { metadata, mintInfo, liquidity, marketCap }); // Debug log

    return {
      name: metadata.name || `Token_${tokenAddress.slice(0, 8)}`,
      address: tokenAddress,
      liquidity: liquidity || null,
      marketCap: marketCap || null,
      devHolding: metadata.devHolding || null,
      poolSupply: metadata.poolSupply || null,
      launchPrice: metadata.price || 0.000005,
      mintAuthRevoked: metadata.mintAuthorityRevoked || mintInfo.mintAuthority?.equals(PublicKey.default) || false,
      freezeAuthRevoked: metadata.freezeAuthorityRevoked || mintInfo.freezeAuthority?.equals(PublicKey.default) || false,
      mint: tokenAddress
    };
  } catch (error) {
    console.error('Error extracting token info for', tokenAddress, ':', error);
    return null; // Return null on error
  }
}

function checkAgainstFilters(token, filters) {
  if (!token || !token.liquidity || !token.marketCap || !token.devHolding || !token.poolSupply || !token.launchPrice) {
    return false; // Skip if any critical data is missing
  }
  return (
    token.liquidity >= filters.liquidity.min &&
    token.liquidity <= filters.liquidity.max &&
    token.marketCap >= filters.marketCap.min &&
    token.marketCap <= filters.marketCap.max &&
    token.devHolding >= filters.devHolding.min &&
    token.devHolding <= filters.devHolding.max &&
    token.poolSupply >= filters.poolSupply.min &&
    token.poolSupply <= filters.poolSupply.max &&
    token.launchPrice >= filters.launchPrice.min &&
    token.launchPrice <= filters.launchPrice.max &&
    (filters.mintAuthRevoked === false || token.mintAuthRevoked === true) &&
    (filters.freezeAuthRevoked === false || token.freezeAuthRevoked === true)
  );
}

function formatTokenMessage(token) {
  return `New Token Alert!\n` +
         `Token Name: ${token.name || 'N/A'}\n` +
         `Token Address: ${token.address || 'N/A'}\n` +
         `Liquidity: ${token.liquidity || 'N/A'}\n` +
         `Market Cap: ${token.marketCap || 'N/A'}\n` +
         `Dev Holding: ${token.devHolding || 'N/A'}%\n` +
         `Pool Supply: ${token.poolSupply || 'N/A'}%\n` +
         `Launch Price: ${token.launchPrice || 'N/A'} SOL\n` +
         `Mint Auth Revoked: ${token.mintAuthRevoked ? 'Yes' : 'No'}\n` +
         `Freeze Auth Revoked: ${token.freezeAuthRevoked ? 'Yes' : 'No'}\n` +
         `Chart: https://dexscreener.com/solana/${token.address || ''}`;
}

module.exports = { extractTokenInfo, checkAgainstFilters, formatTokenMessage };
