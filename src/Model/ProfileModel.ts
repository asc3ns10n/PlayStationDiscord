export interface IAvatar
{
	size : string;
	avatarUrl : string;
}

export interface IProfileModel
{
	onlineId : string;
	avatarUrls : IAvatar[];
	plus : boolean;
	primaryOnlineStatus : string;
}