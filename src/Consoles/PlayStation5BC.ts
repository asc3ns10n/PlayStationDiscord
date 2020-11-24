import { PlayStationConsoleType, PlayStationConsole } from './PlayStationConsole';

export default class PlayStation5BC extends PlayStationConsole
{
	public constructor()
	{
		super(PlayStationConsoleType.PS5BC, '780640522217324584');
	}

	public get assetName() : string
	{
		return 'ps5_main';
	}

	public get consoleName() : string
	{
		return 'PlayStation 5 BC';
	}
}