const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const { Client } = require('discord.js-selfbot-v13');
const axios = require('axios');
const readline = require('readline');
const { exec } = require('child_process');
const express = require('express');

// Configuration - Railway deployment ready
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID || ;
const WEBHOOK_URL = process.env.WEBHOOK_URL || ;
const ITEM_IDS = process.env.ITEM_IDS || ; // Comma-separated item IDs

// Validate required environment variables
if (!DISCORD_TOKEN) {
    console.error('❌ DISCORD_TOKEN environment variable is required!');
    process.exit(1);
}

const client = new Client({ checkUpdate: false });
// Remove readline for Railway deployment - no interactive CLI needed

// Express server for healthcheck
const app = express();
const PORT = process.env.PORT || 3000;

let driver; // Global Selenium WebDriver instance
let waitingForResponse = false;
let processedUsers = new Set();
let currentMode = 'single';
let totalLogged = 0;
let isScraping = false;

// --- VPN SWITCHING ---
const usCities = ['nyc', 'dal', 'atl', 'chi', 'lax', 'sea'];
function switchMullvadVPN() {
    const randomCity = usCities[Math.floor(Math.random() * usCities.length)];
    return new Promise((resolve, reject) => {
        console.log(`🔄 Switching Mullvad VPN to US ${randomCity}...`);
        exec(`mullvad relay set location us ${randomCity}`, (err) => {
            if (err) {
                console.error('❌ Error setting Mullvad location:', err.message);
                return reject(err);
            }
            exec('mullvad connect', (err2) => {
                if (err2) {
                    console.error('❌ Error connecting Mullvad:', err2.message);
                    return reject(err2);
                }
                setTimeout(() => {
                    console.log('✅ VPN switched!');
                    resolve();
                }, 8000);
            });
        });
    });
}

// Healthcheck endpoint
app.get('/', (req, res) => {
    res.json({ 
        status: 'healthy', 
        scraping: isScraping,
        totalLogged: totalLogged,
        timestamp: new Date().toISOString()
    });
});

// Start Express server
app.listen(PORT, () => {
    console.log(`�� Healthcheck server running on port ${PORT}`);
});

client.on('ready', async () => {
    console.log(`${client.user.username} is ready!`);
    await initializeWebDriver();
    
    // Always start scraping with ITEM_IDS from environment
    console.log('🚀 Starting Rolimons scraper...');
    isScraping = true;
    const itemIds = ITEM_IDS.split(',').map(id => id.trim()).filter(id => id && !isNaN(id));
    if (itemIds.length > 0) {
        console.log('⚙️ Starting scrape for items:', itemIds.join(', '));
        for (const itemId of itemIds) {
            await scrapeRolimonsItem(itemId);
        }
        // After all items processed, send webhook and exit
        console.log('Sending webhook: all items scraped...');
        try {
            const response = await axios.post(WEBHOOK_URL, {
                content: "@everyone all items scraped and users logged",
                embeds: [{
                    title: "All Scraping Complete",
                    description: `Scraped items: ${itemIds.join(', ')}`,
                    color: 0x00ff00
                }]
            });
            console.log('✅ Webhook sent! Status:', response.status);
        } catch (e) {
            console.error('❌ Webhook POST error:', e.message);
            if (e.response) {
                console.error('Response status:', e.response.status);
                console.error('Response data:', e.response.data);
            }
        }
        console.log("✅ All items scraped, script finished.");
        isScraping = false;
        // Don't exit - keep the healthcheck server running
    } else {
        console.log('❌ No valid item IDs found in environment variables');
        process.exit(1);
    }
});

async function initializeWebDriver() {
    try {
        console.log('🔧 Initializing Selenium WebDriver...');

        const options = new chrome.Options();
        options.addArguments('--headless');
        options.addArguments('--no-sandbox');
        options.addArguments('--disable-dev-shm-usage');
        options.addArguments('--disable-gpu');
        options.addArguments('--window-size=1920,1080');
        options.addArguments('--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

        driver = await new Builder()
            .forBrowser('chrome')
            .setChromeOptions(options)
            .build();

        console.log('✅ Selenium WebDriver initialized successfully');
        return true;
    } catch (error) {
        console.error('❌ WebDriver initialization error:', error.message);
        return false;
    }
}

// Removed showMainMenu - script now only does scraping

// Removed promptForUsername - script now only does scraping

// Removed promptForItemIds - script now uses ITEM_IDS from environment variables

async function scrapeRolimonsItem(itemId) {
    try {
        const url = `https://www.rolimons.com/item/${itemId}`;
        console.log(`🔍 Getting item information from ${url}`);
        
        // Navigate to the first page to get item name and find pagination
        await driver.get(url);
        await driver.sleep(5000);

        // Extract item name from page title
        let itemName = 'Unknown Item';
        try {
            const titleElement = await driver.findElement(By.css('h1.page_title.mb-0'));
            itemName = await titleElement.getText();
            console.log(`📦 Scraping ${itemName}`);
            
            // Send webhook notification that scraping has started
            console.log('Sending webhook: scraping started...');
            try {
                await axios.post(WEBHOOK_URL, {
                    content: `@everyone scraping ${itemName.toLowerCase()}`
                });
                console.log('✅ Webhook sent for scraping start!');
            } catch (e) {
                console.error('❌ Webhook POST error:', e.message);
                if (e.response) {
                    console.error('Response status:', e.response.status);
                    console.error('Response data:', e.response.data);
                }
            }
        } catch (e) {
            console.log('⚠️ Could not extract item name, using default');
            // Send webhook with default name
            console.log('Sending webhook: scraping unknown item...');
            try {
                await axios.post(WEBHOOK_URL, {
                    content: `@everyone scraping unknown item`
                });
                console.log('✅ Webhook sent for unknown item!');
            } catch (e) {
                console.error('❌ Webhook POST error:', e.message);
                if (e.response) {
                    console.error('Response status:', e.response.status);
                    console.error('Response data:', e.response.data);
                }
            }
        }

        let totalPages = 1;
        
        try {
            // Wait for at least one pagination button to appear
            await driver.wait(until.elementLocated(By.css('a.page-link[data-dt-idx]')), 10000);
            const paginationButtons = await driver.findElements(By.css('a.page-link[data-dt-idx]'));
            if (paginationButtons.length > 0) {
                for (const button of paginationButtons) {
                    const text = await button.getText();
                    if (/^\d+$/.test(text)) {
                        const pageNum = parseInt(text);
                        if (!isNaN(pageNum) && pageNum > totalPages) {
                            totalPages = pageNum;
                        }
                    }
                }
                console.log(`📄 Highest page number found: ${totalPages}`);
                // Click the highest page number button to go to the last page
                for (const button of paginationButtons) {
                    const text = await button.getText();
                    if (parseInt(text) === totalPages) {
                        await button.click();
                        await driver.sleep(5000);
                        console.log(`✅ Successfully navigated to page ${totalPages}`);
                        break;
                    }
                }
            } else {
                console.log('⚠️ No pagination buttons found, assuming single page');
            }
        } catch (e) {
            console.log('⚠️ Error finding pagination:', e.message);
        }

        console.log(`🔄 Starting continuous scraping from page ${totalPages} (last page) going backwards...`);

        for (let page = totalPages; page >= 1; page--) {
            console.log(`\n�� Processing page ${page}/${totalPages}`);
            if (page !== totalPages) {
                // Click the correct pagination button for this page
                const paginationButtons = await driver.findElements(By.css('a.page-link[data-dt-idx]'));
                let found = false;
                for (const button of paginationButtons) {
                    const text = await button.getText();
                    if (text === page.toString()) {
                        await button.click();
                        found = true;
                        await driver.sleep(2000); // Wait for table to update
                        break;
                    }
                }
                if (!found) {
                    console.log(`❌ Could not find button for page ${page}`);
                    continue;
                }
            }
            await driver.sleep(3000);

            let rows = [];
            const tableSelectors = [
                '#bc_owners_table tbody tr',
                'table tbody tr',
                '.table tbody tr',
                'tbody tr'
            ];
            for (const selector of tableSelectors) {
                try {
                    await driver.wait(until.elementLocated(By.css(selector)), 15000);
                    rows = await driver.findElements(By.css(selector));
                    if (rows.length > 0) {
                        console.log(`✅ Found ${rows.length} rows with selector: ${selector}`);
                        break;
                    }
                } catch (e) { continue; }
            }
            if (rows.length === 0) {
                console.log(`❌ No users found on page ${page}, skipping...`);
                continue;
            }
            console.log(`👥 Found ${rows.length} users on page ${page}`);
            console.log(`🔄 Processing users from bottom to top (reverse order)...`);

            for (let i = rows.length - 1; i >= 0; i--) {
                try {
                    const currentRows = await driver.findElements(By.css('#bc_owners_table tbody tr, table tbody tr, .table tbody tr, tbody tr'));
                    if (i >= currentRows.length) {
                        console.log(`⏭️ Row ${i} no longer exists, skipping...`);
                        continue;
                    }
                    const row = currentRows[i];
                    const link = await row.findElement(By.css('a[href*="/player/"]'));
                    const username = await link.getText();
                    const profileUrl = await link.getAttribute('href');

                    if (!username || username.trim() === '') {
                        console.log(`⏭️ Skipping empty username for row ${i} (from bottom)`);
                        await new Promise(res => setTimeout(res, 6000));
                        continue;
                    }
                    if (processedUsers.has(username)) {
                        console.log(`⏭️ Skipping already processed user: ${username}`);
                        await new Promise(res => setTimeout(res, 6000));
                        continue;
                    }

                    console.log(`🔍 Checking user ${rows.length - i}/${rows.length} (row ${i} from bottom): ${username}`);
                    const rolimons = await scrapeRolimonsUserProfile(profileUrl);

                    if (rolimons.tradeAds > 500) {
                        console.log(`❌ Too many trade ads (${rolimons.tradeAds}), skipping ${username}`);
                        processedUsers.add(username);
                        await new Promise(res => setTimeout(res, 6000));
                        continue;
                    }
                    if (rolimons.lastOnlineDays > 4) {
                        console.log(`❌ Last seen too long ago (${rolimons.lastOnlineText}), skipping ${username}`);
                        processedUsers.add(username);
                        await new Promise(res => setTimeout(res, 6000));
                        continue;
                    }
                    if (rolimons.value >= 6000000) {
                        console.log(`❌ Value too high (${rolimons.value}), skipping ${username}`);
                        processedUsers.add(username);
                        await new Promise(res => setTimeout(res, 6000));
                        continue;
                    }

                    // Process user immediately
                    console.log(`🔍 Processing user: ${username}`);
                    await runWhoisCommand(username);

                    // Wait 10 seconds before moving to the next user
                    await new Promise(res => setTimeout(res, 10000));
                    processedUsers.add(username);
                    totalLogged++;

                } catch (error) {
                    console.error(`❌ Error processing row ${i} (from bottom):`, error.message);
                }
            }
            console.log(`✅ Finished page ${page}/${totalPages}`);
        }
        console.log('Sending webhook: all users logged...');
        try {
            const response = await axios.post(WEBHOOK_URL, {
                content: "@everyone all users logged",
                embeds: [{
                    title: "Scraping Complete",
                    description: `Total users logged: ${totalLogged}`,
                    color: 0x00ff00
                }]
            });
            console.log('✅ Webhook sent! Status:', response.status);
        } catch (e) {
            console.error('❌ Webhook POST error:', e.message);
            if (e.response) {
                console.error('Response status:', e.response.status);
                console.error('Response data:', e.response.data);
            }
        }
        console.log("✅ All users logged, script finished.");
        isScraping = false;
        // Don't exit - keep the healthcheck server running
    } catch (error) {
        console.error('❌ Error during scraping:', error.message);
        console.log('🔄 Restarting scrape in 10 seconds...');
        setTimeout(() => scrapeRolimonsItem(itemId), 10000);
    }
}

function parseLastOnlineDays(text) {
    text = text.toLowerCase();
    if (
        text.includes('second') ||
        text.includes('minute') ||
        text.includes('hour') ||
        text.includes('just now')
    ) {
        return 0;
    }
    const match = text.match(/(\d+)\s*day/);
    if (match) {
        return parseInt(match[1]);
    }
    return 999; // fallback for unknown format
}

async function scrapeRolimonsUserProfile(profileUrl) {
    const tempDriver = await new Builder()
        .forBrowser('chrome')
        .setChromeOptions(
            new chrome.Options()
                .addArguments('--headless')
                .addArguments('--disable-gpu')
                .addArguments('--window-size=1920,1080')
                .addArguments('--no-sandbox')
                .addArguments('--disable-dev-shm-usage')
        )
        .build();

    try {
        await tempDriver.get(profileUrl);
        await tempDriver.sleep(2000);

        const getText = async (selector) => {
            try {
                const element = await tempDriver.findElement(By.css(selector));
                return await element.getText();
            } catch {
                return '';
            }
        };

        let tradeAds = 0;
        try {
            try {
                const tradeAdsElement = await tempDriver.findElement(By.css('span.card-title.mb-1.text-light.stat-data.text-nowrap'));
                const text = await tradeAdsElement.getText();
                if (text && !isNaN(text.replace(/,/g, ''))) {
                    tradeAds = parseInt(text.replace(/,/g, '')) || 0;
                    console.log(`✅ Found trade ads with exact selector: ${tradeAds}`);
                }
            } catch (e) {
                console.log('⚠️ Exact selector failed, trying contextual search...');
            }
            if (tradeAds === 0) {
                try {
                    const contextElements = await tempDriver.findElements(By.xpath("//*[contains(text(), 'Trade Ads') and contains(text(), 'Created')]/following::*[contains(@class, 'stat-data')][1] | //*[contains(text(), 'Trade Ads') and contains(text(), 'Created')]/..//*[contains(@class, 'stat-data')]"));
                    if (contextElements.length > 0) {
                        const text = await contextElements[0].getText();
                        if (text && !isNaN(text.replace(/,/g, ''))) {
                            tradeAds = parseInt(text.replace(/,/g, '')) || 0;
                            console.log(`✅ Found trade ads via "Trade Ads Created" context: ${tradeAds}`);
                        }
                    }
                } catch (e) {
                    console.log('⚠️ Contextual search failed, trying alternative selectors...');
                }
            }
            if (tradeAds === 0) {
                const selectors = [
                    '.card-title.mb-1.text-light.stat-data.text-nowrap',
                    'span.stat-data.text-nowrap',
                    '.stat-data.text-nowrap',
                    '.card-title.stat-data'
                ];
                for (const selector of selectors) {
                    try {
                        const elements = await tempDriver.findElements(By.css(selector));
                        for (const element of elements) {
                            const text = await element.getText();
                            if (text && /^\d{1,3}(,\d{3})*$/.test(text)) {
                                const numValue = parseInt(text.replace(/,/g, ''));
                                if (numValue > 0 && numValue <= 50000) {
                                    tradeAds = numValue;
                                    console.log(`✅ Found trade ads: ${tradeAds} using selector: ${selector}`);
                                    break;
                                }
                            }
                        }
                        if (tradeAds > 0) break;
                    } catch (e) { continue; }
                }
            }
            if (tradeAds === 0) {
                console.log('⚠️ Could not find trade ads with any method');
            }
        } catch (e) {
            console.log('⚠️ Error finding trade ads:', e.message);
        }
        const rap = parseInt((await getText('#player_rap')).replace(/,/g, '')) || 0;
        const value = parseInt((await getText('#player_value')).replace(/,/g, '')) || 0;
        const lastOnlineText = await getText('#location_pane_last_seen_online');

        let lastOnlineDays = parseLastOnlineDays(lastOnlineText);

        return {
            tradeAds,
            rap,
            value,
            avatarUrl: '',
            lastOnlineText,
            lastOnlineDays
        };
    } catch (error) {
        console.error('❌ Failed to scrape profile:', error.message);
        return {
            tradeAds: 0,
            rap: 0,
            value: 0,
            avatarUrl: '',
            lastOnlineText: 'Unknown',
            lastOnlineDays: 999
        };
    } finally {
        await tempDriver.quit();
    }
}

async function runWhoisCommand(username) {
    global.currentRobloxUsername = username; // Set this BEFORE sending the command
    console.log(`Running /whois roblox username:${username}...`);
    
    const channel = await client.channels.fetch(CHANNEL_ID);
    waitingForResponse = true;
    
    // Send as a real slash command (like in scraper.js)
    await channel.sendSlash('298796807323123712', 'whois roblox', username);
    console.log('✅ Slash command sent');
}

async function getRobloxUserData(username) {
    try {
        const userResponse = await axios.post('https://users.roblox.com/v1/usernames/users', { usernames: [username] });
        if (!userResponse.data.data || userResponse.data.data.length === 0) {
            throw new Error('User not found');
        }

        const user = userResponse.data.data[0];

        const thumbnailResponse = await axios.get(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${user.id}&size=420x420&format=Png`);
        const thumbnailUrl = thumbnailResponse.data.data[0]?.imageUrl || 'https://www.roblox.com/headshot-thumbnail/image?userId=1&width=420&height=420&format=png';

        let totalRAP = 0;
        try {
            const inventory = await axios.get(`https://inventory.roblox.com/v1/users/${user.id}/assets/collectibles?sortOrder=Asc&limit=100`);
            for (const item of inventory.data.data) {
                if (item.recentAveragePrice > 0) totalRAP += item.recentAveragePrice;
            }
        } catch (e) {
            console.log('Could not fetch RAP data');
        }

        return {
            userId: user.id,
            username: user.name,
            displayName: user.displayName,
            thumbnailUrl,
            totalRAP
        };

    } catch (error) {
        console.error('❌ Failed to fetch Roblox data:', error.message);
        return null;
    }
}

async function sendToWebhook(robloxUsername, discordUsername, rolimonsData) {
    console.log(`📤 sendToWebhook called: Roblox=${robloxUsername}, Discord=${discordUsername}`);
    try {
        // Extract just the username from Discord mention/ID
        let cleanDiscordUsername = discordUsername;
        if (discordUsername.includes('<@') && discordUsername.includes('>')) {
            // It's a mention, extract the username part
            cleanDiscordUsername = discordUsername.replace(/<@!?(\d+)>/g, 'User ID: $1');
        }
        
        const payload = {
            embeds: [{
                title: "�� New Discord Found!",
                color: 0x00AE86,
                fields: [
                    { name: "Roblox", value: robloxUsername, inline: true },
                    { name: "Discord", value: cleanDiscordUsername, inline: true }
                ],
                timestamp: new Date().toISOString()
            }]
        };
        console.log('Sending webhook: new Discord found...');
        const response = await axios.post(WEBHOOK_URL, payload);
        console.log('✅ Webhook sent successfully, status:', response.status);
    } catch (e) {
        console.error('❌ Webhook POST error:', e.message);
        if (e.response) {
            console.error('Response status:', e.response.status);
            console.error('Response data:', e.response.data);
        }
    }
}

async function cleanup() {
    if (driver) {
        try {
            await driver.quit();
        } catch (e) {
            console.log('Error closing driver:', e.message);
        }
    }
    client.destroy();
    // Only close readline if it exists (local development)
    if (typeof rl !== 'undefined') {
        rl.close();
    }
    process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('uncaughtException', async (error) => {
    console.error('Uncaught Exception:', error);
    await cleanup();
});

client.on('error', (error) => {
    console.error('Client error:', error);
});

client.on('messageCreate', async (message) => {
    // Only process messages from the correct bot and channel, and only if waiting for a response
    if (message.author.id !== '298796807323123712' || message.channel.id !== CHANNEL_ID || !waitingForResponse) return;
    
    console.log('📨 Received Discord bot response');
    waitingForResponse = false;
    let discordUsername = '';
    let isUserFound = false;

    if (message.embeds && message.embeds.length > 0) {
        const embed = message.embeds[0];
        // Try to extract from description (where RoVer puts the Discord username)
        if (embed.description) {
            // The Discord username is the first line
            discordUsername = embed.description.split('\n')[0].trim();
            // Check if it's a valid Discord username (not an error message)
            if (discordUsername && !discordUsername.includes('Specified user is not in this server') && !discordUsername.includes('not verified')) {
                isUserFound = true;
            }
        }
        // Fallback: check fields for a Discord username
        if (!discordUsername && embed.fields && embed.fields.length > 0) {
            for (const field of embed.fields) {
                if (field.name.toLowerCase().includes('discord')) {
                    discordUsername = field.value;
                    if (discordUsername && !discordUsername.includes('Specified user is not in this server') && !discordUsername.includes('not verified')) {
                        isUserFound = true;
                    }
                    break;
                }
            }
        }
    }

    // Only send webhook if user is actually found
    if (isUserFound && discordUsername && global.currentRobloxUsername) {
        console.log(`✅ Discord found: ${discordUsername} for ${global.currentRobloxUsername}`);
        await sendToWebhook(global.currentRobloxUsername, discordUsername, {});
        global.currentRobloxUsername = null;
    } else {
        console.log('❌ No valid Discord user found in bot response');
        global.currentRobloxUsername = null;
    }
});

// Railway deployment logging
console.log('🚀 Starting Railway deployment...');
console.log('�� Configuration:');
console.log(`   - Discord Token: ${DISCORD_TOKEN.substring(0, 20)}...`);
console.log(`   - Channel ID: ${CHANNEL_ID}`);
console.log(`   - Webhook URL: ${WEBHOOK_URL.substring(0, 50)}...`);
console.log(`   - Item IDs: ${ITEM_IDS}`);
console.log('🔐 Logging in to Discord...');
client.login(DISCORD_TOKEN);

// --- WEBHOOK TEST FUNCTION ---
async function testWebhook() {
    console.log('Testing webhook...');
    try {
        const response = await axios.post(WEBHOOK_URL, { content: 'Test webhook from scraper2.js' });
        console.log('✅ Webhook test sent! Status:', response.status);
    } catch (e) {
        console.error('❌ Webhook TEST error:', e.message);
        if (e.response) {
            console.error('Response status:', e.response.status);
            console.error('Response data:', e.response.data);
        }
    }
}
// Example: Uncomment to test
// testWebhook();
