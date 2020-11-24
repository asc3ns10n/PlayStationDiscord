import { PlayStationConsoleType, PlayStationConsole } from './PlayStationConsole';

export default class PlayStation5 extends PlayStationConsole
{
	public constructor()
	{
		super(PlayStationConsoleType.PS5, '761727384897454111');
	}

	public get assetName() : string
	{
		return 'ps5_main';
	}

	public get consoleName() : string
	{
		return 'PlayStation 5';
	}
}