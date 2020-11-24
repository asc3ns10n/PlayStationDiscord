import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell, Tray, Menu, Notification, MenuItemConstructorOptions, MenuItem, session } from 'electron';
import { IOAuthTokenResponse, } from './Model/AuthenticationModel';
import { DiscordController } from './DiscordController';
import {PlayStationConsole, PlayStationConsoleType } from './Consoles/PlayStationConsole';
import { IDiscordPresenceModel, IDiscordPresenceUpdateOptions } from './Model/DiscordPresenceModel';
import { autoUpdater } from 'electron-updater';
import axios from 'axios';
import PlayStation5BC from './Consoles/PlayStation5BC';
import PlayStation5 from './Consoles/PlayStation5';
import PlayStation4 from './Consoles/PlayStation4';
import PlayStation3 from './Consoles/PlayStation3';
import PlayStationVita from './Consoles/PlayStationVita';
import appEvent from './Events';
import PlayStationAccount from './PlayStation/Account';

import _store = require('electron-store');
import queryString = require('query-string');
import log = require('electron-log');
import url = require('url');
import path = require('path');
import { IBasicPresence, IPresenceModel } from './Model/PresenceModel';
import { ILegacyPresence, ILegacyProfile } from './Model/LegacyPresenceModel';
import { IUnifiedPresenceModel } from './Model/UnifiedPresenceModel';
import * as _ from 'lodash';

const isDev = process.env.NODE_ENV === 'dev';

const supportedGames = require('./SupportedGames');

const store = new _store();

const sonyLoginUrl : string = 'https://ca.account.sony.com/api/authz/v3/oauth/authorize?response_type=code&app_context=inapp_ios&device_profile=mobile&extraQueryParams=%7B%0A%20%20%20%20PlatformPrivacyWs1%20%3D%20minimal%3B%0A%7D&token_format=jwt&access_type=offline&scope=psn%3Amobile.v1%20psn%3Aclientapp&service_entity=urn%3Aservice-entity%3Apsn&ui=pr&smcid=psapp%253Asettings-entrance&darkmode=true&redirect_uri=com.playstation.PlayStationApp%3A%2F%2Fredirect&support_scheme=sneiprls&client_id=ac8d161a-d966-4728-b0ea-ffec22f69edc&duid=0000000d0004008088347AA0C79542D3B656EBB51CE3EBE1&device_base_font_size=10&elements_visibility=no_aclink&service_logo=ps';

const logoIcon = nativeImage.createFromPath(path.join(__dirname, '../assets/images/logo.png'));

// Mac (#41)
const trayLogoIcon = nativeImage.createFromPath(path.join(__dirname, '../assets/images/trayLogo.png'));

// Windows
let mainWindow : BrowserWindow;
let loginWindow : BrowserWindow;

// Instance of the logged in account
let playstationAccount : PlayStationAccount;

// Discord stuff
let discordController : DiscordController;
let presence : IBasicPresence;
let legacyPresence : ILegacyProfile;
let unifiedPresence : IUnifiedPresenceModel;
let previousPresence : IUnifiedPresenceModel;

// Loop Ids
let updateRichPresenceLoop : NodeJS.Timeout;
let refreshAuthTokensLoop : NodeJS.Timeout;

autoUpdater.autoDownload = false;

if (isDev)
{
	log.transports.file.level = 'debug';
	log.transports.console.level = 'debug';
}
else
{
	log.transports.file.level = 'info';
	log.transports.console.level = 'info';
}

const instanceLock = app.requestSingleInstanceLock();
if (!instanceLock)
{
	app.quit();
}

// axios.interceptors.request.use((request) => {
// 	log.debug('Firing axios request:', request);

// 	return request;
// });

app.setAppUserModelId('com.tustin.playstationdiscord');

// Relevant: https://i.imgur.com/7QDkNqx.png
function showMessageAndDie(message: string, detail?: string) : void
{
	dialog.showMessageBox(null, {
		type: 'error',
		title: 'PlayStationDiscord Error',
		message,
		detail,
		icon: logoIcon
	});

	app.quit();
}

function spawnLoginWindow() : void
{
	loginWindow = new BrowserWindow({
		width: 414,
		height: 743,
		minWidth: 414,
		minHeight: 763,
		icon: logoIcon,
		webPreferences: {
			nodeIntegration: false,
			enableRemoteModule: false,
			plugins: true
		}
	});

	loginWindow.setMenu(null);

	loginWindow.on('closed', () => {
		loginWindow = null;
	});

	loginWindow.loadURL(sonyLoginUrl, {
		userAgent: 'Mozilla/5.0'
	});

	loginWindow.webContents.on('will-redirect', (event, url) => {
		if (url.startsWith('com.playstation.playstationapp://redirect/'))
		{
			const query : string = queryString.extract(url);
			const items : any = queryString.parse(query);

			if (!items.code)
			{
				log.error('Redirect URL was found but there was no code in the query string', items);

				showMessageAndDie(
					'An error has occurred during the PSN login process. Please try again.',
					'If the problem persists, please open an issue on the GitHub repo.'
				);

				return;
			}

			PlayStationAccount.login(items.code)
			.then((account) => {
				playstationAccount = account;

				store.set('tokens', account.data);

				log.info('Saved oauth tokens');

				spawnMainWindow();

				loginWindow.close();
			})
			.catch((err) => {
				log.error('Unable to get PSN OAuth tokens', err);

				showMessageAndDie(
					'An error has occurred during the PSN login process. Please try again.',
					'If the problem persists, please open an issue on the GitHub repo.'
				);
			});
		}
	});
}

function spawnMainWindow() : void
{
	const contextMenu = Menu.buildFromTemplate([
		{
			label: 'Show Application',
			click:  () => mainWindow.show()
		},
		{
			label: 'Toggle Presence',
			click:  () => ipcMain.emit('toggle-presence')
		},
		{
			label: 'Quit',
			click:  () => {
				mainWindow.destroy();
				app.quit();
			}
		}
	]);

	const tray = new Tray(trayLogoIcon); // #41

	tray.setContextMenu(contextMenu);
	tray.setToolTip('PlayStationDiscord');

	mainWindow = new BrowserWindow({
		width: 512,
		height: 512,
		minWidth: 512,
		minHeight: 512,
		show: false,
		icon: logoIcon,
		backgroundColor: '#23272a',
		webPreferences: {
			nodeIntegration: true,
			enableRemoteModule: true
		},
		frame: false,
		title: 'PlayStationDiscord'
	});

	mainWindow.loadURL(url.format({
		pathname: path.join(__dirname, 'app.html'),
		protocol: 'file:',
		slashes: true
	}));

	mainWindow.webContents.on('did-finish-load', () => {
		if (!isDev)
		{
			autoUpdater.checkForUpdates().catch((reason) => {
				log.error('Failed checking for update', reason);
			});
		}
		else
		{
			log.debug('Skipping update check because app is running in dev mode');
		}

		playstationAccount.profile()
		.then((profile) => {
			log.debug('Got PSN profile info', profile);
			mainWindow.webContents.send('profile-data', profile);
		}).catch((err) => {
			log.error('Failed fetching PSN profile', err);
		});

		appEvent.emit('start-rich-presence');
	});

	mainWindow.on('ready-to-show', () => {
		mainWindow.show();
		mainWindow.focus();
	});

	mainWindow.on('closed', () => {
		mainWindow = null;
	});

	//  #44
	mainWindow.on('show', () => {
		if (process.platform === 'darwin') {
			app.dock.show();
		}
	});

	mainWindow.on('minimize', () => {
		mainWindow.hide();

		//  #44
		if (process.platform === 'darwin') {
			app.dock.hide();
		}

		if (Notification.isSupported())
		{
			let bodyText : string;

			if (process.platform === 'darwin') {
				bodyText = 'PlayStationDiscord is still running. You can restore it by clicking the icon in the menubar.';
			} else {
				bodyText = 'PlayStationDiscord is still running in the tray. You can restore it by double clicking the icon in the tray.';
			}
			const notification = new Notification({
				title: 'Still Here!',
				body: bodyText,
				icon: logoIcon
			});

			notification.show();
		}
		else
		{
			log.warn('Tray notification not shown because notifications aren\'t supported on this platform', process.platform);
		}

		tray.on('double-click', () => {
			if (!mainWindow.isVisible())
			{
				mainWindow.show();
				mainWindow.focus();
			}
		});
	});
}

let richPresenceRetries : number;
let supportedTitleId : string;

function setPresence(data: IBasicPresence) : void
{
	presence = data;
}

function setLegacyPresence(data: ILegacyProfile) : void
{
	legacyPresence = data;
}

function getPresences() : void
{
	playstationAccount.presences()
	.then((presence) => setPresence(presence))
	.catch((err) => {
		log.error('Failed fetching PSN presence', err);

		if (++richPresenceRetries === 5)
		{
			updateRichPresenceLoop = stopTimer(updateRichPresenceLoop);

			log.error('Stopped rich presence loop because of too many retries without success');
		}
	});
	const onlineStatus = _.get(presence, ['primaryPlatformInfo', 'onlineStatus']);

	playstationAccount.legacyPresences()
	.then((legacyPresence) => setLegacyPresence(legacyPresence))
	.catch((err) => {
		log.error('Failed fetching legacy PSN presence', err);

		if (++richPresenceRetries === 5)
		{
			updateRichPresenceLoop = stopTimer(updateRichPresenceLoop);

			log.error('Stopped rich presence loop because of too many retries without success');
		}
	});
	const legacyOnlineStatus = _.get(legacyPresence, ['primaryOnlineStatus']);

	if (onlineStatus !== 'online' && legacyOnlineStatus !== 'online')
	{
		if (discordController && discordController.running())
		{
			discordController.stop();
			previousPresence = undefined;

			log.info('DiscordController stopped because the user is not online on PlayStation');
		}

		// Just update the form like this so we don't update rich presence.
		mainWindow.webContents.send('presence-data', {
			details: 'Offline'
		});
	}
	else if (onlineStatus === 'online')
	{
		const presenceData = _.get(presence, ['gameTitleInfoList', 0]);

		unifiedPresence = {
			platform: presence.primaryPlatformInfo.platform,
			format: _.get(presenceData, ['format']),
			npTitleId: _.get(presenceData, ['npTitleId']),
			titleName: _.get(presenceData, ['titleName']),
			gameStatus: undefined
		};

		updateRichPresence(unifiedPresence);
	}
	else if (legacyOnlineStatus === 'online' && onlineStatus === 'offline')
	{
		const presenceData = legacyPresence.presences[0];

		unifiedPresence = {
			platform: presenceData.platform,
			format: presenceData.platform,
			npTitleId: presenceData.npTitleId,
			titleName: presenceData.titleName,
			gameStatus: presenceData.gameStatus
		};

		updateRichPresence(unifiedPresence);
	}

	richPresenceRetries = 0;
}

function updateRichPresence(unifiedPresence: IUnifiedPresenceModel) : void
{

	let discordRichPresenceData : IDiscordPresenceModel;
	let discordRichPresenceOptionsData : IDiscordPresenceUpdateOptions;

	if (previousPresence === undefined || unifiedPresence.platform !== previousPresence.platform && unifiedPresence.format !== previousPresence.format)
	{
		log.info('Switching console to ', unifiedPresence.platform);

		// Reset cached presence so we get fresh data.
		previousPresence = undefined;

		if (discordController)
		{
			discordController.stop();
			discordController = undefined;
		}

		// If the playing a PS4 game on PS5, set the console type to PS5BC.
		// Otherwise, set it using the platform
		let platformType;
		if (unifiedPresence.format === 'ps4')
		{
			platformType = PlayStationConsoleType['PS5BC' as (keyof typeof PlayStationConsoleType)];
		}
		else
		{
			platformType = PlayStationConsoleType[unifiedPresence.platform as (keyof typeof PlayStationConsoleType)];
		}

		if (platformType === undefined)
		{
			log.error(`Unexpected platform type ${unifiedPresence.platform} was not found in PlayStationConsoleType`);

			return showMessageAndDie(`An error occurred when trying to assign/switch PlayStation console.`);
		}

		const playstationConsole = getConsoleFromType(platformType);

		if (playstationConsole === undefined)
		{
			log.error(`No suitable PlayStationConsole abstraction could be derived from platform type ${platformType}`);

			return showMessageAndDie(`An error occurred when trying to assign/switch PlayStation console.`);
		}

		discordController = new DiscordController(playstationConsole);

		log.info('Switched console to', playstationConsole.consoleName);
	}

	// Setup previous presence with the current presence if it's empty.
	// Update status if the titleId has changed.
	if (previousPresence === undefined || previousPresence.npTitleId !== unifiedPresence.npTitleId)
	{
		// See if we're actually playing a title.
		if (unifiedPresence.npTitleId === undefined)
		{
			discordRichPresenceData = {
				details: 'Online',
			};

			discordRichPresenceOptionsData = {
				hideTimestamp: true
			};

			log.info('Status set to online');
		}
		else
		{
			discordRichPresenceData = {
				details: unifiedPresence.titleName,
				state: unifiedPresence.gameStatus,
				startTimestamp: Date.now(),
				largeImageText: unifiedPresence.titleName
			};

			log.info('Game has switched', unifiedPresence.titleName);

			const discordFriendly = supportedGames.get(unifiedPresence);

			if (discordFriendly !== undefined)
			{
				supportedTitleId = discordFriendly.titleId.toLowerCase();
				discordRichPresenceData.largeImageKey = supportedTitleId;

				log.info('Using game icon since it is supported');
			}
			else
			{
				log.warn('Game icon not found in supported games store', unifiedPresence.titleName, unifiedPresence.npTitleId);
				supportedTitleId = undefined;
			}
		}
	}
	// Update if game status has changed.
	else if (previousPresence === undefined || previousPresence.gameStatus !== previousPresence.gameStatus)
	{
		discordRichPresenceData = {
			details: unifiedPresence.titleName,
			state: unifiedPresence.gameStatus,
			largeImageText: unifiedPresence.titleName
		};

		if (supportedTitleId !== undefined)
		{
			discordRichPresenceData.largeImageKey = supportedTitleId;
		}

		log.info('Game status has changed', unifiedPresence.gameStatus);
	}

	// Only send a rich presence update if we have something new and it's enabled.
	if (discordRichPresenceData !== undefined && store.get('presenceEnabled', true))
	{
		// Cache it.
		previousPresence = unifiedPresence;

		discordController.update(discordRichPresenceData, discordRichPresenceOptionsData).then(() => {
			log.info('Updated rich presence');
			mainWindow.webContents.send('presence-data', discordRichPresenceData);
		}).catch((err) => {
			log.error('Failed updating rich presence', err);
		});
	}
}

function getConsoleFromType(type: PlayStationConsoleType) : PlayStationConsole
{
	switch (type)
	{
		case PlayStationConsoleType.PS5BC:
			return new PlayStation5BC();
		case PlayStationConsoleType.PS5:
			return new PlayStation5();
		case PlayStationConsoleType.PS4:
			return new PlayStation4();
		case PlayStationConsoleType.PS3:
			return new PlayStation3();
		case PlayStationConsoleType.PSVITA:
			return new PlayStationVita();
		default:
			return undefined;
	}
}

// For some reason, despite Timeout being a reference, it doesn't seem like you can undefine it by reference.
function stopTimer(timer: NodeJS.Timeout) : any
{
	clearInterval(timer);

	return undefined;
}

function signoutCleanup()
{
	spawnLoginWindow();
	store.clear();
	refreshAuthTokensLoop = stopTimer(refreshAuthTokensLoop);
	updateRichPresenceLoop = stopTimer(updateRichPresenceLoop);
	mainWindow.close();
}

function toggleDiscordReconnect(toggle: boolean) : void
{
	if (mainWindow)
	{
		mainWindow.webContents.send('toggle-discord-reconnect', toggle);
	}
}

function sendUpdateStatus(data: any) : void
{
	if (mainWindow)
	{
		mainWindow.webContents.send('update-status', data);
	}
}

appEvent.on('logged-in', () => {
	log.debug('logged-in event triggered');

	if (refreshAuthTokensLoop)
	{
		log.warn('logged-in was fired but refreshAuthTokensLoop is already running so nothing is being done');

		return;
	}

	log.info('Running refreshAuthTokensLoop');

	// Going to hardcode this refresh value for now in case it is causing issues.
	// Old expire time: parseInt(store.get('tokens.expires_in'), 10) * 1000);
	refreshAuthTokensLoop = setInterval(() => {
		playstationAccount.refresh()
		.then((data) => {
			store.set('tokens', data);

			log.info('Refreshed PSN OAuth tokens');
		})
		.catch((err) => {
			log.error('Failed refreshing PSN OAuth tokens', err);
		});
	}, 3599 * 1000);
});

appEvent.on('tokens-refresh-failed', (err) => {
	dialog.showMessageBox(mainWindow, {
		type: 'error',
		title: 'PlayStationDiscord Error',
		message: 'An error occurred while trying to refresh your authorization tokens. You will need to login again.',
		icon: logoIcon
	});

	signoutCleanup();
});

appEvent.on('start-rich-presence', () => {
	if (!updateRichPresenceLoop)
	{
		log.info('Starting rich presence loop');
		// Start getting rich presence data.
		getPresences();

		// Set the loop timeout id so it can be cancelled globally.
		updateRichPresenceLoop = setInterval(getPresences, 15000);
	}
});

appEvent.on('stop-rich-presence', () => {
	updateRichPresenceLoop = stopTimer(updateRichPresenceLoop);
	previousPresence = undefined;

	log.info('Stopped rich presence loop');
});

ipcMain.on('toggle-presence', () => {
	const newValue = !store.get('presenceEnabled');
	store.set('presenceEnabled', newValue);

	if (!newValue && discordController)
	{
		appEvent.emit('stop-rich-presence');
		discordController.stop();
	}
	else
	{
		appEvent.emit('start-rich-presence');
	}
});

// Needs Testing
ipcMain.on('signout', async () => {

	const response = dialog.showMessageBox(mainWindow, {
		type: 'question',
		title: 'PlayStationDiscord Alert',
		buttons: ['Yes', 'No'],
		defaultId: 0,
		message: 'Are you sure you want to sign out?',
		icon: logoIcon
	});

	if (!response)
	{
		signoutCleanup();
	}
});

autoUpdater.on('download-progress', ({ percent }) => {
	sendUpdateStatus({
		message: `Downloading update ${Math.round(percent)}%`,
	});
});

autoUpdater.on('checking-for-update', () => {
	sendUpdateStatus({
		message: 'Checking for updates',
		icon: 'bars'
	});
});

autoUpdater.on('update-available', (info) => {
	sendUpdateStatus({
		message: 'New update available',
		icons: 'success'
	});

	// Because macOS requires code-signing for auto updating, we'll just have them download the update manually.
	if (process.platform === 'darwin')
	{
		sendUpdateStatus({
			message: 'New update available. <u id="mac-download">Click here</u> to download!',
			icons: 'success'
		});
	}
	else
	{
		autoUpdater.downloadUpdate();
	}
});

autoUpdater.on('update-not-available', (info) => {
	sendUpdateStatus({
		message: 'Up to date!',
		fade: true,
		icon: 'success'
	});
});

autoUpdater.on('update-downloaded', () => {
	sendUpdateStatus({
		message: 'Update downloaded. Please <u id="install">click here</u> to install - <u id="notes">Release Notes</u>',
		icon: 'success'
	});
});

autoUpdater.on('error', (err) => {
	log.error(err);

	sendUpdateStatus({
		message: 'Auto update failed!',
		icon: 'error'
	});
});

ipcMain.on('update-install', () => {
	autoUpdater.quitAndInstall(true, true);
});

ipcMain.on('show-notes', () => {
	shell.openExternal('https://github.com/Tustin/PlayStationDiscord/releases/latest');
});

ipcMain.on('mac-download', () => {
	shell.openExternal('https://tusticles.com/PlayStationDiscord/');
});

ipcMain.on('discord-reconnect', () => {
	log.info('Starting Discord reconnect');

	toggleDiscordReconnect(false);

	appEvent.emit('start-rich-presence');
});

appEvent.on('discord-disconnected', () => {
	log.warn('DiscordController disconnected');
	discordController = undefined;

	appEvent.emit('stop-rich-presence');

	toggleDiscordReconnect(true);
});

app.on('second-instance', () => {
	if (!mainWindow)
	{
		return;
	}

	if (mainWindow.isMinimized())
	{
		mainWindow.restore();
	}

	return mainWindow.focus();
});

app.on('ready', () => {
	// Fix for #26
	if (process.platform === 'darwin')
	{
		Menu.setApplicationMenu(Menu.buildFromTemplate([
			{
				label: 'Application',
				submenu: [
					{ label: 'Quit', accelerator: 'Command+Q', click: () => app.quit() }
				]
			},
			{
				label: 'Edit',
				submenu: [
					{ role: 'undo' },
					{ role: 'redo' },
					{ type: 'separator' },
					{ role: 'cut' },
					{ role: 'copy' },
					{ role: 'paste' },
					{ role: 'pasteAndMatchStyle' },
					{ role: 'delete' },
					{ role: 'selectAll' }
				]
		}]));
	}

	if (store.has('tokens'))
	{
		PlayStationAccount.loginWithRefresh(store.get('tokens') as IOAuthTokenResponse)
		.then((account) => {
			playstationAccount = account;

			store.set('tokens', playstationAccount.data);

			log.info('Logged in with existing refresh token');

			spawnMainWindow();
		})
		.catch((err) => {
			log.error('Failed logging in with saved refresh token', err);

			spawnLoginWindow();
		});
	}
	else
	{
		spawnLoginWindow();
	}
});

app.on('window-all-closed', () => {
	// I know macOS likes to keep the program running if the user clicks X on a window
	// But that is stupid behavior and makes no sense so we're just going to quit the application like normal.
	app.quit();
});
