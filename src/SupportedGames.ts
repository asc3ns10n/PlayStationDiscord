import _store = require('electron-store');
import log = require('electron-log');
import axios from 'axios';
import { IUnifiedPresenceModel } from './Model/UnifiedPresenceModel';
const unorm = require('unorm');

interface IGame
{
	name : string;
	titleId : string;
}

interface ISupportedGames
{
	ps5 : IGame[];
	ps4 : IGame[];
	ps3 : IGame[];
	vita : IGame[];
	etag : string;
}

class SupportedGames
{
	public static get instance() : SupportedGames
	{
		return this._instance || (this._instance = new this());
	}

	private static _instance : SupportedGames;

	private store : any;

	private constructor()
	{
		this.store = new _store({
			name: 'games',
		});

		const checksum = this.store.get('etag');

		const headers : any = {
			'User-Agent': 'PlayStationDiscord (https://github.com/Tustin/PlayStationDiscord)'
		};

		if (checksum)
		{
			headers['If-None-Match'] = checksum;
		}

		axios.get(`https://raw.githubusercontent.com/asc3ns10n/PlayStationDiscord-Games/development/games.json?_=${Date.now()}`, {
			headers
		})
		.then((response) => {
			this.store.set('consoles', response.data);
			this.store.set('etag', response.headers.etag);

			log.info('Saved new version of games.json');
		})
		.catch((err) => {
			if (err.response.status === 304)
			{
				log.info('PlayStationDiscord-Games has not been updated, using cached version');

				return undefined;
			}

			log.error('Failed requesting games.json from the PlayStationDiscord-Games repo', err);
		});
	}

	public get(presence: IUnifiedPresenceModel) : IGame
	{
		const format = presence.format;
		const console = presence.platform.toLowerCase();

		// If the playing a PS4 game on PS5, set consoleStore to PS4.
		// Otherwise, set it to the console.
		let consoleStore;
		if (format === 'ps4')
		{
			consoleStore = `consoles.ps4`;
		}
		else
		{
			consoleStore = `consoles.${console}`;
		}

		if (!this.store.has(consoleStore))
		{
			log.debug('no console found in supported games list.');

			return undefined;
		}

		return this.store.get(consoleStore).find((game: IGame) => {
			if (game.titleId.toLowerCase() === presence.npTitleId.toLowerCase()) {
				return true;
			}

			return unorm.nfc(game.name.toLowerCase()).indexOf(unorm.nfc(presence.titleName.toLowerCase())) !== -1;
		});
	}
}

module.exports = SupportedGames.instance;