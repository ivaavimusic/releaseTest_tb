// Token List Component
// Displays tokens in alphabetical order from different sources based on active mode

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    initTokenList();
});

// Simple in-memory cache for resolved contract addresses
const __tokenResolveCache = new Map();

// Minimal ERC20 ABI
const __erc20Abi = [
    'function name() view returns (string)',
    'function symbol() view returns (string)',
    'function decimals() view returns (uint8)'
];

// Utility: check if a string looks like an EVM address
function isPossibleAddress(str) {
    if (!str) return false;
    const s = str.trim();
    return /^0x[a-fA-F0-9]{40}$/.test(s);
}

// Load JSON from multiple possible locations (userData -> resources -> dev -> fetch)
async function loadConfigFile(filename) {
    try {
        const fs = require('fs');
        const path = require('path');
        const { ipcRenderer } = require('electron');

        // 1) userData
        try {
            const userDataPath = await ipcRenderer.invoke('get-user-data-path');
            if (userDataPath) {
                const p = path.join(userDataPath, filename);
                if (fs.existsSync(p)) {
                    return JSON.parse(fs.readFileSync(p, 'utf8'));
                }
            }
        } catch {}

        // 2) resources
        try {
            const resourcesPath = process.resourcesPath || null;
            if (resourcesPath) {
                const candidates = [
                    path.join(resourcesPath, filename),
                    path.join(resourcesPath, 'app.asar.unpacked', filename),
                    path.join(resourcesPath, 'app.asar', filename)
                ];
                for (const p of candidates) {
                    if (fs.existsSync(p)) {
                        return JSON.parse(fs.readFileSync(p, 'utf8'));
                    }
                }
            }
        } catch {}

        // 3) dev
        try {
            const devCandidates = [
                path.join(__dirname, filename),
                path.join(__dirname, '..', filename),
                path.join(__dirname, '..', '..', filename)
            ];
            for (const p of devCandidates) {
                if (fs.existsSync(p)) {
                    return JSON.parse(fs.readFileSync(p, 'utf8'));
                }
            }
        } catch {}

        // 4) fetch relative
        try {
            const response = await fetch(filename, { cache: 'no-store' });
            if (response.ok) {
                return await response.json();
            }
        } catch {}
    } catch (e) {
        console.warn(`Failed to load ${filename}:`, e.message);
    }
    throw new Error(`Could not load ${filename}`);
}

function decodeBase64Url(b64) {
    try {
        if (!b64) return '';
        return Buffer.from(b64, 'base64').toString('utf8');
    } catch {
        return '';
    }
}

async function getPrimaryBaseRpcUrl() {
    try {
        const wallets = await loadConfigFile('wallets.json');
        // Prefer networks with chainId 8453 and enabled
        const nets = (wallets && wallets.networks) || [];
        const baseNets = nets.filter(n => n.enabled !== false && (n.chainId === 8453 || wallets.chainId === 8453));
        // If per-network chainId missing, fall back to root chainId
        const pick = baseNets[0] || nets[0];
        const decoded = decodeBase64Url(pick && pick.rpcUrl);
        return decoded || '';
    } catch (e) {
        console.warn('Failed to resolve Base RPC from wallets.json, falling back to env/provider defaults:', e.message);
        return '';
    }
}

async function resolveTokenByAddress(address) {
    const ca = address.trim();
    if (__tokenResolveCache.has(ca)) return __tokenResolveCache.get(ca);

    const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), ms));
    const doResolve = (async () => {
        const { ethers } = require('ethers');
        let rpc = await getPrimaryBaseRpcUrl();
        if (!rpc) {
            // As a last resort, try a public Base RPC to avoid total failure
            rpc = 'https://mainnet.base.org';
        }
        const provider = new ethers.JsonRpcProvider(rpc);
        const erc20 = new ethers.Contract(ca, __erc20Abi, provider);
        let name = '', symbol = '', decimals = 18;
        try { name = await erc20.name(); } catch {}
        try { symbol = await erc20.symbol(); } catch {}
        try { decimals = await erc20.decimals(); } catch {}
        if (!symbol && !name) throw new Error('No metadata');
        const token = {
            symbol: symbol || (name ? name.slice(0, 8) : 'TOKEN'),
            name: name || symbol || 'Token',
            address: ca,
            blockchain: 'BASE',
            marketcap: 0,
            decimals
        };
        __tokenResolveCache.set(ca, token);
        return token;
    })();

    // 12s timeout
    return Promise.race([doResolve, timeout(12000)]);
}

function initTokenList() {
    const container = document.getElementById('token-list-container');
    if (!container) return;

    // Create token list structure
    container.innerHTML = `
        <div class="token-list-header">
            <div class="token-list-controls">
                <div class="search-input-group">
                    <input type="text" class="token-search" placeholder="Search tokens..." />
                    <div class="token-sort-icon">
                        <i class="fas fa-sort-down" style="font-size: 24px;"></i>
                        <div class="token-sort-dropdown">
                            <!-- <div class="token-sort-option" data-sort="marketcap">Sort by Market Cap</div> -->
                            <div class="token-sort-option" data-sort="name">Sort by Name</div>
                            <!-- <div class="token-sort-option" data-sort="symbol">Sort by Symbol</div> -->
                        </div>
                    </div>
                </div>
                <button class="token-refresh-btn" title="Refresh tokens">
                    <i class="fas fa-sync"></i>
                </button>
                <div class="selected-tokens-display-right" id="selected-tokens-display-right">
                    <!-- Selected tokens will be displayed here -->
                </div>
            </div>
        </div>
        <div class="token-list-wrapper">
            <div class="token-list-loading">Loading tokens...</div>
        </div>
    `;

    const searchInput = container.querySelector('.token-search');
    const sortIcon = container.querySelector('.token-sort-icon');
    const sortDropdown = container.querySelector('.token-sort-dropdown');
    const sortOptions = container.querySelectorAll('.token-sort-option');
    const contentDiv = container.querySelector('.token-list-wrapper');
    const refreshBtn = container.querySelector('.token-refresh-btn');
    // Keep references to refresh icon and its previous class for proper spinner lifecycle
    const refreshIcon = refreshBtn ? refreshBtn.querySelector('i') : null;
    let refreshPrevClass = null;
    
    // Current sort value
    let currentSortValue = 'name';

    // Load tokens based on current mode
    loadTokens(contentDiv, searchInput, currentSortValue);

    // Add event listeners
    searchInput.addEventListener('input', () => {
        filterTokens(contentDiv, searchInput.value, currentSortValue);
    });
    // Handle paste explicitly to speed up CA resolution
    searchInput.addEventListener('paste', (e) => {
        setTimeout(() => {
            filterTokens(contentDiv, searchInput.value, currentSortValue);
        }, 0);
    });
    
    // Toggle sort dropdown
    sortIcon.addEventListener('click', (e) => {
        e.stopPropagation();
        sortDropdown.classList.toggle('active');
    });
    
    // Close dropdown when clicking elsewhere
    document.addEventListener('click', () => {
        sortDropdown.classList.remove('active');
    });
    
    // Sort options click handlers
    sortOptions.forEach(option => {
        option.addEventListener('click', (e) => {
            e.stopPropagation();
            currentSortValue = option.getAttribute('data-sort');
            filterTokens(contentDiv, searchInput.value, currentSortValue);
            sortDropdown.classList.remove('active');
        });
    });

    // Refresh tokens button handler
    if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
            const { ipcRenderer } = require('electron');
            // UI feedback
            refreshBtn.disabled = true;
            refreshPrevClass = refreshIcon ? refreshIcon.className : null;
            if (refreshIcon) refreshIcon.className = 'fas fa-sync fa-spin';
            showTokenNotification('Refreshing token list...', 'info');
            try {
                // Trigger update in main (writes to userData), then reload list
                const res = await ipcRenderer.invoke('run-ticker-update');
                if (res && res.success) {
                    showTokenNotification('Token list updated. Reloading...', 'success');
                } else {
                    showTokenNotification(`Update failed: ${res?.error || 'Unknown error'}`, 'error');
                }
            } catch (e) {
                console.warn('Refresh via IPC failed, reloading tokens only:', e.message);
            }
        });
    }

    // Listen for completion event from main process and refresh tokens
    try {
        const { ipcRenderer } = require('electron');
        ipcRenderer.removeAllListeners && ipcRenderer.removeAllListeners('ticker-update-completed');
        ipcRenderer.on('ticker-update-completed', async (_event, payload) => {
            const msg = payload?.success ? (payload.message || 'Token database updated') : (payload?.message || 'Token update failed');
            showTokenNotification(msg, payload?.success ? 'success' : 'error');
            try {
                const tokenCount = await loadTokens(contentDiv, searchInput, currentSortValue);
                // Ensure exact message appears in mini console
                if (typeof window.addConsoleMessage === 'function') {
                    window.addConsoleMessage('Tokens List Updated', 'success');
                } else {
                    console.log('Tokens List Updated');
                }
            } catch (e) {
                console.warn('Failed to reload tokens on completion event:', e.message);
            }
            // Restore refresh button/icon state now that update completed
            if (refreshIcon) {
                refreshIcon.className = refreshPrevClass || 'fas fa-sync';
            }
            refreshPrevClass = null;
            if (refreshBtn) refreshBtn.disabled = false;
        });
    } catch {}

    // Listen for mode changes
    document.addEventListener('bid-mode-changed', (event) => {
        loadTokens(contentDiv, searchInput, currentSortValue);
    });
}

async function loadTokens(contentDiv, searchInput, sortBy) {
    contentDiv.innerHTML = '<div class="token-list-loading">Loading tokens...</div>';
    
    try {
        let tokens = [];
        const isBidMode = document.body.classList.contains('bid-mode-active');
        
        // Create a global mapping of token addresses to labels
        window.baseTokenLabels = {};
        
        // Function to load tokens preferring userData (updated by updater), then fallbacks
        async function loadTokenFile(filename) {
            try {
                console.log(`Loading token file: ${filename}`);
                const fs = require('fs');
                const path = require('path');
                const { ipcRenderer } = require('electron');

                // Helper to enrich base.json data with labels if missing
                function enrichBaseDataIfNeeded(arr) {
                    try {
                        if (filename !== 'base.json') return arr;
                        if (!Array.isArray(arr) || arr.length === 0) return arr;
                        const missingLabels = arr.every(t => !t.label);
                        if (!missingLabels) return arr; // labels present

                        // Try to read bundled base.json to fetch labels
                        const candidates = [
                            path.join(__dirname, 'base.json'),
                            path.join(__dirname, '..', 'base.json'),
                            path.join(__dirname, '..', '..', 'base.json')
                        ];
                        let bundled = [];
                        for (const p of candidates) {
                            if (fs.existsSync(p)) {
                                try { bundled = JSON.parse(fs.readFileSync(p, 'utf8')); break; } catch {}
                            }
                        }
                        if (!Array.isArray(bundled) || bundled.length === 0) return arr;
                        const labelMap = {};
                        bundled.forEach(t => {
                            if (t.tokenAddress && t.label) labelMap[t.tokenAddress.toLowerCase()] = t.label;
                        });
                        arr.forEach(t => {
                            const key = t.tokenAddress ? String(t.tokenAddress).toLowerCase() : '';
                            if (!t.label && key && labelMap[key]) t.label = labelMap[key];
                        });
                        console.log('Enriched base.json with labels from bundled copy');
                        return arr;
                    } catch (e) {
                        console.warn('enrichBaseDataIfNeeded failed:', e.message);
                        return arr;
                    }
                }

                // 1) Prefer userData directory (packaged updater writes here)
                try {
                    const userDataPath = await ipcRenderer.invoke('get-user-data-path');
                    if (userDataPath) {
                        const userDataFile = path.join(userDataPath, filename);
                        if (fs.existsSync(userDataFile)) {
                            console.log(`Reading ${filename} from userData: ${userDataFile}`);
                            const data = fs.readFileSync(userDataFile, 'utf8');
                            const parsed = JSON.parse(data);
                            return filename === 'base.json' ? enrichBaseDataIfNeeded(parsed) : parsed;
                        } else {
                            console.log(`${filename} not found in userData, trying bundled resources...`);
                        }
                    } else {
                        console.log('Could not resolve userData path');
                    }
                } catch (e) {
                    console.warn('Failed to read from userData:', e.message);
                }

                // 2) Packaged resources fallbacks
                try {
                    const resourcesPath = process.resourcesPath || null;
                    if (resourcesPath) {
                        const candidates = [
                            path.join(resourcesPath, filename),
                            path.join(resourcesPath, 'app.asar.unpacked', filename),
                            path.join(resourcesPath, 'app.asar', filename)
                        ];
                        for (const p of candidates) {
                            console.log(`Trying bundled path: ${p}`);
                            if (fs.existsSync(p)) {
                                const data = fs.readFileSync(p, 'utf8');
                                const parsed = JSON.parse(data);
                                return filename === 'base.json' ? enrichBaseDataIfNeeded(parsed) : parsed;
                            }
                        }
                    }
                } catch (e) {
                    console.warn('Failed to read from bundled resources:', e.message);
                }

                // 3) Development/local file fallbacks
                try {
                    const devCandidates = [
                        path.join(__dirname, filename),
                        path.join(__dirname, '..', filename),
                        path.join(__dirname, '..', '..', filename)
                    ];
                    for (const p of devCandidates) {
                        console.log(`Trying dev path: ${p}`);
                        if (fs.existsSync(p)) {
                            const data = fs.readFileSync(p, 'utf8');
                            const parsed = JSON.parse(data);
                            return filename === 'base.json' ? enrichBaseDataIfNeeded(parsed) : parsed;
                        }
                    }
                } catch (e) {
                    console.warn('Dev path read attempts failed:', e.message);
                }

                // 4) Last resort: fetch relative
                try {
                    const response = await fetch(filename, { cache: 'no-store' });
                    if (response.ok) {
                        const parsed = await response.json();
                        return filename === 'base.json' ? enrichBaseDataIfNeeded(parsed) : parsed;
                    }
                } catch (e) {
                    console.warn('Fetch fallback failed:', e.message);
                }

                throw new Error(`Could not load ${filename} from any location`);
            } catch (e) {
                console.warn(`Failed to read tokens from ${filename}:`, e.message);
                return [];
            }
        }
        
        if (isBidMode) {
            // Load BID tokens
            const bidData = await loadTokenFile('bid.json');
            // Also load base.json to get labels
            const baseData = await loadTokenFile('base.json');
            // If userData base.json lacks labels, enrich from bundled copy
            try {
                const fs = require('fs');
                const path = require('path');
                const bundledCandidates = [
                    path.join(__dirname, 'base.json'),
                    path.join(__dirname, '..', 'base.json'),
                    path.join(__dirname, '..', '..', 'base.json')
                ];
                const bundledLabels = {};
                for (const p of bundledCandidates) {
                    if (fs.existsSync(p)) {
                        try {
                            const data = JSON.parse(fs.readFileSync(p, 'utf8'));
                            data.forEach(t => {
                                if (t.tokenAddress && t.label) {
                                    bundledLabels[t.tokenAddress.toLowerCase()] = t.label;
                                }
                            });
                            break;
                        } catch {}
                    }
                }
                // Merge labels into baseData when missing
                baseData.forEach(t => {
                    if (!t.label && bundledLabels[t.tokenAddress?.toLowerCase()]) {
                        t.label = bundledLabels[t.tokenAddress.toLowerCase()];
                    }
                });
            } catch (e) {
                console.warn('Label enrichment (BID) failed:', e.message);
            }
            
            // Populate the global mapping of token addresses to labels
            baseData.forEach(token => {
                if (token.label) {
                    window.baseTokenLabels[token.tokenAddress.toLowerCase()] = token.label;
                }
            });
            
            console.log('Created global mapping of token addresses to labels:', 
                Object.keys(window.baseTokenLabels).length, 'tokens mapped');
            
            tokens = bidData.map(token => {
                // Look up the label for this token address
                const label = tokenLabels[token.tokenAddress.toLowerCase()] || 'BASE';
                return {
                    symbol: token.symbol,
                    name: token.name || token.tokenName || token.symbol,
                    address: token.tokenAddress,
                    blockchain: label,
                    marketcap: token.mcapInETH || 0
                };
            });
            console.log('BID mode active - loaded bid.json tokens:', tokens.length);
        } else {
            // Load only BASE tokens (ETH tokens temporarily disabled)
            const baseData = await loadTokenFile('base.json');
            // If userData base.json lacks labels, enrich from bundled copy
            try {
                const fs = require('fs');
                const path = require('path');
                const bundledCandidates = [
                    path.join(__dirname, 'base.json'),
                    path.join(__dirname, '..', 'base.json'),
                    path.join(__dirname, '..', '..', 'base.json')
                ];
                const bundledLabels = {};
                for (const p of bundledCandidates) {
                    if (fs.existsSync(p)) {
                        try {
                            const data = JSON.parse(fs.readFileSync(p, 'utf8'));
                            data.forEach(t => {
                                if (t.tokenAddress && t.label) {
                                    bundledLabels[t.tokenAddress.toLowerCase()] = t.label;
                                }
                            });
                            break;
                        } catch {}
                    }
                }
                // Merge labels into baseData when missing
                baseData.forEach(t => {
                    if (!t.label && bundledLabels[t.tokenAddress?.toLowerCase()]) {
                        t.label = bundledLabels[t.tokenAddress.toLowerCase()];
                    }
                });
            } catch (e) {
                console.warn('Label enrichment (BASE) failed:', e.message);
            }
            
            // Populate the global mapping of token addresses to labels
            baseData.forEach(token => {
                if (token.label) {
                    window.baseTokenLabels[token.tokenAddress.toLowerCase()] = token.label;
                }
            });
            
            console.log('Created global mapping of token addresses to labels:', 
                Object.keys(window.baseTokenLabels).length, 'tokens mapped');
            console.log('Sample labels:', 
                Object.entries(window.baseTokenLabels).slice(0, 3));
            
            // Format BASE tokens
            const baseTokens = baseData.map(token => ({
                symbol: token.symbol,
                name: token.name || token.tokenName || token.symbol,
                address: token.tokenAddress,
                blockchain: token.label || 'BASE', // Use label from base.json if available
                marketcap: token.mcapInVirtual || 0
            }));
            
            /* ETH tokens temporarily disabled as they're not supported yet
            const ethData = await loadTokenFile('eth.json');
            const ethTokens = ethData.map(token => ({
                symbol: token.symbol,
                name: token.name || token.tokenName || token.symbol,
                address: token.tokenAddress,
                blockchain: 'ETH',
                marketcap: token.mcapInVirtual || 0
            }));
            tokens = [...baseTokens, ...ethTokens];
            */
            
            tokens = baseTokens;
            console.log('Virtual mode active - loaded base.json tokens only:', tokens.length);
        }
        
        // Sort tokens by name by default
        tokens.sort((a, b) => {
            const aName = a.name || a.symbol || '';
            const bName = b.name || b.symbol || '';
            const aNameForSort = aName.startsWith('$') ? aName.substring(1) : aName;
            const bNameForSort = bName.startsWith('$') ? bName.substring(1) : bName;
            return aNameForSort.localeCompare(bNameForSort);
        });
        
        // Display tokens
        displayTokens(contentDiv, tokens, searchInput.value || '', sortBy || 'name');
        // Log to the app console view if available
        try {
            showTokenNotification(`Tokens list updated (${tokens.length} items)`, 'success');
        } catch {}
        return tokens.length;
    } catch (error) {
        console.error('Error loading tokens:', error);
        contentDiv.innerHTML = '<div class="token-list-error">Failed to load tokens. Please try again.</div>';
        return 0;
    }
}

function displayTokens(contentDiv, tokens, searchTerm = '', sortBy = 'name') {
    // Ensure base label map is available (synchronous, safe in renderer)
    (function ensureBaseLabelsLoadedSync() {
        try {
            if (window.baseTokenLabels && Object.keys(window.baseTokenLabels).length > 0) return;
            const fs = require('fs');
            const path = require('path');
            const candidates = [
                path.join(__dirname, 'base.json'),
                path.join(__dirname, '..', 'base.json'),
                path.join(__dirname, '..', '..', 'base.json')
            ];
            for (const p of candidates) {
                if (fs.existsSync(p)) {
                    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
                    window.baseTokenLabels = {};
                    data.forEach(t => {
                        if (t.tokenAddress && t.label) {
                            window.baseTokenLabels[t.tokenAddress.toLowerCase()] = t.label;
                        }
                    });
                    break;
                }
            }
        } catch (e) {
            console.warn('displayTokens label map load failed:', e.message);
        }
    })();
    // Debug: Log the first few tokens to see if they have the correct blockchain labels
    console.log('displayTokens - First 3 tokens:', JSON.stringify(tokens.slice(0, 3), null, 2));
    // Sort tokens
    if (sortBy === 'name') {
        // Sort by name (fallback to symbol if name is not available)
        // Strip leading $ for sorting comparison
        tokens.sort((a, b) => {
            const aName = a.name || a.symbol;
            const bName = b.name || b.symbol;
            
            // Strip leading $ for comparison if present
            const aNameForSort = aName.startsWith('$') ? aName.substring(1) : aName;
            const bNameForSort = bName.startsWith('$') ? bName.substring(1) : bName;
            
            return aNameForSort.localeCompare(bNameForSort);
        });
    } else if (sortBy === 'symbol') {
        // Sort by symbol
        tokens.sort((a, b) => a.symbol.localeCompare(b.symbol));
    } else if (sortBy === 'marketcap') {
        // Sort by market cap (highest to lowest)
        tokens.sort((a, b) => b.marketcap - a.marketcap);
    }
    
    // Filter tokens if search term exists
    if (searchTerm) {
        const term = searchTerm.toLowerCase();
        tokens = tokens.filter(token => 
            token.symbol.toLowerCase().includes(term) || 
            token.address.toLowerCase().includes(term) ||
            (token.name && token.name.toLowerCase().includes(term))
        );
    }
    
    if (tokens.length === 0) {
        contentDiv.innerHTML = '<div style="padding: 20px; text-align: center; color: #888;">No tokens found</div>';
        return;
    }
    
    // Create token list HTML
    let tokenListHTML = '<ul class="token-list">';
    
    // Debug: Log the first few tokens being displayed
    console.log('First few tokens being displayed:', tokens.slice(0, 3));
    
    tokenListHTML += tokens.map(token => {
        const shortAddress = `${token.address.substring(0, 6)}...${token.address.substring(token.address.length - 4)}`;
        
        // Strip leading $ from symbol for display
        const displaySymbol = token.symbol && token.symbol.startsWith('$') 
            ? token.symbol.substring(1) 
            : token.symbol;
        
        // Determine CSS class based on blockchain label
        let blockchainClass = '';
        // Always prefer mapping from base.json if available
        let displayBlockchain = (window.baseTokenLabels && window.baseTokenLabels[token.address.toLowerCase()])
            ? window.baseTokenLabels[token.address.toLowerCase()]
            : token.blockchain;
        
        if (displayBlockchain === 'Genesis') {
            blockchainClass = 'genesis-label';
        } else if (displayBlockchain === 'Sentient') {
            blockchainClass = 'sentient-label';
        }
        
        return `
            <li class="token-item" data-address="${token.address}" data-symbol="${token.symbol}" data-blockchain="${token.blockchain}">
                <div class="token-info">
                    <div class="token-symbol">${displaySymbol}</div>
                </div>
                <div class="token-address">
                    ${shortAddress}
                </div>
                <div class="token-blockchain ${blockchainClass}">${displayBlockchain}</div>
                <button class="token-copy-btn" data-address="${token.address}" title="Copy address">
                    <i class="fas fa-copy"></i>
                </button>
                <button class="token-add-btn" data-address="${token.address}" data-symbol="${token.symbol}" title="Add to selection">
                    <i class="fas fa-plus"></i>
                </button>
            </li>
        `;
    }).join('');
    
    tokenListHTML += '</ul>';
    contentDiv.innerHTML = tokenListHTML;
    
    // Add copy button event listeners
    const copyButtons = contentDiv.querySelectorAll('.token-copy-btn');
    copyButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            const address = button.getAttribute('data-address');
            copyToClipboard(address, button);
        });
    });
    
    // Add token-add button event listeners
    const addButtons = contentDiv.querySelectorAll('.token-add-btn');
    addButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            const address = button.getAttribute('data-address');
            const symbol = button.getAttribute('data-symbol');
            const blockchain = button.getAttribute('data-blockchain');
            
            // Determine if we're in BID mode or Virtuals mode
            const isBidMode = document.body.classList.contains('bid-mode-active');
            
            if (isBidMode) {
                // Add to BID mode selection using the existing BID token selection system
                if (typeof window.BidTokenSelectionUI !== 'undefined' && window.BidTokenSelectionUI.selectToken) {
                    const tokenData = {
                        symbol: symbol,
                        tokenAddress: address,
                        blockchain: blockchain
                    };
                    window.BidTokenSelectionUI.selectToken(tokenData);
                    showTokenNotification(`Added ${symbol} to BID token selection`, 'success');
                } else {
                    showTokenNotification('BID token selection system not available', 'error');
                }
            } else {
                // Directly replicate the selectToken() behavior from token-selection.js
                const tokenData = {
                    symbol: symbol,
                    tokenAddress: address,
                    address: address,
                    blockchain: blockchain,
                    id: address
                };
                
                // Access the TokenSelectionUI's private selectedTokens array via the public API
                let currentSelectedTokens = [];
                if (window.TokenSelectionUI && typeof window.TokenSelectionUI.getSelectedTokens === 'function') {
                    currentSelectedTokens = window.TokenSelectionUI.getSelectedTokens();
                }
                
                // Check if token is already selected
                const alreadySelected = currentSelectedTokens.some(t => t.tokenAddress === tokenData.tokenAddress);
                
                if (!alreadySelected) {
                    // Add to selectedTokens array
                    currentSelectedTokens.push(tokenData);
                    
                    // Update TokenSelectionUI's internal state if available
                    if (window.TokenSelectionUI && typeof window.TokenSelectionUI.setSelectedTokens === 'function') {
                        window.TokenSelectionUI.setSelectedTokens(currentSelectedTokens);
                    }
                    
                    // Update header display directly
                    updateHeaderTokenDisplay(currentSelectedTokens);
                    
                    // Update global state
                    window.selectedTickers = [...currentSelectedTokens];
                    
                    // Save to persistence
                    if (window.TokenPersistence && typeof window.TokenPersistence.saveTokens === 'function') {
                        window.TokenPersistence.saveTokens([...currentSelectedTokens]);
                    }
                    
                    // Dispatch custom event
                    const tokenEvent = new CustomEvent('token-selection-changed', { 
                        detail: { selectedTokens: [...currentSelectedTokens], action: 'add', token: tokenData } 
                    });
                    window.dispatchEvent(tokenEvent);
                    
                    showTokenNotification(`Added ${symbol} to token selection`, 'success');
                } else {
                    showTokenNotification(`${symbol} already selected`, 'info');
                }
            }
        });
    });
}

function filterTokens(contentDiv, searchTerm, sortBy) {
    // If search is cleared, reload all tokens
    if (!searchTerm || searchTerm.trim() === '') {
        loadTokens(contentDiv, document.querySelector('.token-search'), sortBy);
        return;
    }
    
    // Always reload the complete token dataset and filter from that
    // This ensures we search from all tokens, not just currently displayed ones
    loadTokens(contentDiv, document.querySelector('.token-search'), sortBy).then(() => {
        // After loading complete dataset, apply the search filter
        setTimeout(() => {
            // Get all token items from the freshly loaded complete dataset
            const tokenItems = Array.from(contentDiv.querySelectorAll('.token-item'));
            // Even if there are no token items yet, we still want to attempt CA resolution
            
            // Extract token data from complete dataset
            const tokens = tokenItems.map(item => {
                return {
                    symbol: item.querySelector('.token-symbol').textContent,
                    address: item.getAttribute('data-address'),
                    blockchain: item.querySelector('.token-blockchain').textContent
                };
            });
            
            // Filter in-memory first
            const term = (searchTerm || '').toLowerCase().trim();
            const filtered = tokens.filter(t =>
                (t.symbol && t.symbol.toLowerCase().includes(term)) ||
                (t.address && t.address.toLowerCase().includes(term)) ||
                (t.name && t.name.toLowerCase().includes(term))
            );

            if (filtered.length > 0) {
                // Display filtered tokens from complete dataset
                displayTokens(contentDiv, filtered, '', sortBy);
                return;
            }

            // If no local match and input looks like a contract address, resolve via RPC
            if (isPossibleAddress(searchTerm)) {
                contentDiv.innerHTML = '<div class="token-list-loading">Resolving contract address...</div>';
                resolveTokenByAddress(searchTerm)
                    .then(token => {
                        displayTokens(contentDiv, [token], '', sortBy);
                    })
                    .catch(err => {
                        console.warn('CA resolve failed:', err.message);
                        contentDiv.innerHTML = '<div style="padding: 20px; text-align: center; color: #888;">No tokens found</div>';
                    });
                return;
            }

            // Default: no results
            contentDiv.innerHTML = '<div style="padding: 20px; text-align: center; color: #888;">No tokens found</div>';
        }, 50);
    }).catch(() => {
        // If loadTokens fails, just reload without search term
        loadTokens(contentDiv, document.querySelector('.token-search'), sortBy);
    });
}

// Utility function to copy to clipboard
function copyToClipboard(text, button) {
    navigator.clipboard.writeText(text)
        .then(() => {
            // Temporarily change icon to indicate success
            const icon = button.querySelector('i');
            icon.className = 'fas fa-check';
            setTimeout(() => {
                icon.className = 'fas fa-copy';
            }, 1000);
        })
        .catch(err => {
            console.error('Error copying to clipboard:', err);
        });
}

// Show notification using the main app's console system
function showTokenNotification(message, type = 'info') {
    // Try to use the main app's console system
    if (typeof window.addConsoleMessage === 'function') {
        const prefix = type === 'success' ? '✅' : 
                      type === 'error' ? '❌' : 
                      type === 'warning' ? '⚠️' : 'ℹ️';
        window.addConsoleMessage(`${prefix} Token List: ${message}`, type);
    } else {
        // Fallback to console
        console.log(`[Token List ${type.toUpperCase()}] ${message}`);
    }
}

// Update the header token display - replicated from token-selection.js
function updateHeaderTokenDisplay(selectedTokens) {
    const tokenDisplay = document.getElementById('selected-tokens-display');
    const tokenDisplayRight = document.getElementById('selected-tokens-display-right');
    if (!tokenDisplay || !tokenDisplayRight) {
        console.warn('TOKEN-LIST: selected-tokens-display element not found');
        return;
    }

    const enabledTokens = selectedTokens.filter(token => token.enabled !== false);

    if (enabledTokens.length === 0) {
        tokenDisplay.innerHTML = '';
        tokenDisplayRight.innerHTML = '';
        return;
    }
    tokenDisplay.innerHTML = '';
    tokenDisplayRight.innerHTML = '';
    
    // Display all tokens - they'll be in a scrollbox
    const tokensToDisplay = enabledTokens;

    // Create chips for each token
    tokensToDisplay.forEach(token => {
        const rawSymbol = token.symbol || shortenAddress(token.tokenAddress);
        const symbol = rawSymbol && rawSymbol.startsWith('$') 
            ? rawSymbol.substring(1) 
            : rawSymbol;
        
        // Create token chip for header display
        const tokenChip = document.createElement('span');
        tokenChip.className = 'selected-token-chip';
        tokenChip.setAttribute('data-token-id', token.id || token.address || token.symbol);

        // Create text span with truncation
        const textSpan = document.createElement('span');
        textSpan.className = 'chip-text';
        textSpan.textContent = symbol;
        tokenChip.appendChild(textSpan);

        // Create remove button for header
        const removeBtn = document.createElement('button');
        removeBtn.className = 'token-remove-btn';
        removeBtn.textContent = '×';
        
        // Handle token removal
        removeBtn.onclick = (function(tokenObj) {
            return function(event) {
                event.stopPropagation();
                console.log('TOKEN-LIST: Removing token:', tokenObj);
                removeTokenFromSelection(tokenObj);
            };
        })(token);
        
        tokenChip.appendChild(removeBtn);
        tokenDisplay.appendChild(tokenChip);
        
        // Create separate token chip for right pane display
        const tokenChipRight = document.createElement('span');
        tokenChipRight.className = 'selected-token-chip';
        tokenChipRight.setAttribute('data-token-id', token.id || token.address || token.symbol);

        // Create text span with truncation for right pane
        const textSpanRight = document.createElement('span');
        textSpanRight.className = 'chip-text';
        textSpanRight.textContent = symbol;
        tokenChipRight.appendChild(textSpanRight);

        // Create remove button for right pane
        const removeBtnRight = document.createElement('button');
        removeBtnRight.className = 'token-remove-btn';
        removeBtnRight.textContent = '×';
        
        // Handle token removal for right pane
        removeBtnRight.onclick = (function(tokenObj) {
            return function(event) {
                event.stopPropagation();
                console.log('TOKEN-LIST: Removing token from right pane:', tokenObj);
                removeTokenFromSelection(tokenObj);
            };
        })(token);
        
        tokenChipRight.appendChild(removeBtnRight);
        tokenDisplayRight.appendChild(tokenChipRight);
    });
}

// Helper function to shorten address for display
function shortenAddress(address) {
    if (!address) return '';
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
}

// Remove token from selection
function removeTokenFromSelection(tokenToRemove) {
    // Get current selected tokens
    let currentSelectedTokens = [];
    if (window.TokenSelectionUI && typeof window.TokenSelectionUI.getSelectedTokens === 'function') {
        currentSelectedTokens = window.TokenSelectionUI.getSelectedTokens();
    }
    
    // Remove the token
    const updatedTokens = currentSelectedTokens.filter(token => 
        token.tokenAddress !== tokenToRemove.tokenAddress
    );
    
    // Update TokenSelectionUI's internal state if available
    if (window.TokenSelectionUI && typeof window.TokenSelectionUI.setSelectedTokens === 'function') {
        window.TokenSelectionUI.setSelectedTokens(updatedTokens);
    }
    
    // Update header display
    updateHeaderTokenDisplay(updatedTokens);
    
    // Update global state
    window.selectedTickers = [...updatedTokens];
    
    // Save to persistence
    if (window.TokenPersistence && typeof window.TokenPersistence.saveTokens === 'function') {
        window.TokenPersistence.saveTokens([...updatedTokens]);
    }
    
    // Dispatch custom event
    const tokenEvent = new CustomEvent('token-selection-changed', { 
        detail: { selectedTokens: [...updatedTokens], action: 'remove', token: tokenToRemove } 
    });
    window.dispatchEvent(tokenEvent);
    
    showTokenNotification(`Removed ${tokenToRemove.symbol} from selection`, 'info');
}

// Make essential functions available globally
window.copyToClipboard = copyToClipboard;
window.showTokenNotification = showTokenNotification;
