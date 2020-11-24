export interface ILegacyPresence
{
	onlineStatus : string;
	platform : string;
	npTitleId : string;
	titleName : string;
	npTitleIconUrl : string;
	gameStatus : string;
}

export interface ILegacyProfile
{
	primaryOnlineStatus : string;
	presences : ILegacyPresence[];
}

export interface ILegacyPresenceModel
{
	profile : ILegacyProfile;
}