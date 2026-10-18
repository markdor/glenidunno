// The 17 tastings of the imported history (history-import.json, #27) as the
// world map counts them: per bottle only its distillery, no usernames. With
// DISTILLERY_FACTS (issue #44) they give the reference values of the issue.

export const HISTORY_TASTINGS: Array<{ date: string; distilleries: string[] }> = [
	{
		date: '2020-11-06',
		distilleries: ['Pulteney', 'Aberlour', 'Tomintoul', 'Glen Garioch', 'Gelephu', 'Box']
	},
	{
		date: '2021-01-22',
		distilleries: ['Arran', 'Kilchoman', 'Balmenach', 'Springbank', 'Glenrothes', 'BenRiach']
	},
	{
		date: '2021-03-19',
		distilleries: [
			'Pulteney',
			'Inchgower',
			'Aultmore',
			'Ardmore',
			'Stauning Whisky',
			'The Glasgow Distillery Co.'
		]
	},
	{
		date: '2021-05-07',
		distilleries: ['Mackmyra', 'Nc’nean', 'Strathearn', 'Glen Spey', 'Linkwood', 'Bunnahabhain']
	},
	{
		date: '2021-11-12',
		distilleries: ['Highland Park', 'Laphroaig', 'Royal Brackla', 'Balblair', 'Raasay', 'Laphroaig']
	},
	{
		date: '2022-02-18',
		distilleries: [
			'Glenallachie',
			'Ardbeg',
			'Blend',
			'Ailsa Bay',
			'Kavalan',
			'Benromach',
			'Laphroaig'
		]
	},
	{
		date: '2022-10-21',
		distilleries: ['Glenturret', 'BenRiach', 'Jura', 'Wolfburn', 'Deanston', 'Ardbeg', 'Ardbeg']
	},
	{
		date: '2023-03-03',
		distilleries: ['Balvenie', 'Deanston', 'Ardnamurchan', 'Glendullan', 'Torabhaig', 'Miyagikyo']
	},
	{
		date: '2023-04-28',
		distilleries: [
			'Bruichladdich',
			'Bruichladdich',
			'Balmenach',
			'Blend',
			'Bad Kötztinger Bärwurz-Quelle',
			'Glenallachie',
			'Caol Ila'
		]
	},
	{
		date: '2023-12-01',
		distilleries: ['Glenturret', 'Balvenie', 'BenRiach', 'Lagavulin', 'Loch Lomond', 'Bunnahabhain']
	},
	{
		date: '2024-02-02',
		distilleries: ['Wolfburn', 'Lagg', 'Eimverk', 'M&H Whisky', 'Edradour', 'Talisker']
	},
	{
		date: '2024-09-27',
		distilleries: [
			'Bunnahabhain',
			'Ardnahoe',
			'Lochlea',
			'Lagavulin',
			'Lantenhammer',
			'Springbank',
			'Mackmyra'
		]
	},
	{
		date: '2024-11-29',
		distilleries: [
			'Ben Nevis',
			'Craigellachie',
			'Teaninich',
			'The Glasgow Distillery Co.',
			'Amrut',
			'Kavalan'
		]
	},
	{
		date: '2025-04-25',
		distilleries: [
			'BenRiach',
			'Kilchoman',
			'Benrinnes',
			'Caol Ila',
			'Highland Park',
			'Glenallachie'
		]
	},
	{
		date: '2025-11-21',
		distilleries: [
			'Inchgower',
			'Thomson Whisky New Zealand Ltd',
			'Glenmorangie',
			'Deanston',
			'Dailuaine',
			'Lagavulin',
			'BenRiach'
		]
	},
	{
		date: '2026-02-06',
		distilleries: ['Glen Elgin', 'Bunnahabhain', 'Ben Nevis', 'Unbekannt', 'Bladnoch', 'Unbekannt']
	},
	{
		date: '2026-04-30',
		distilleries: ['Glencadam', 'Glen Scotia', 'Jura', 'Unbekannt', 'Tamnavulin', 'Teerenpeli']
	}
];

/** Country and region as in the table `distillery` (#39); capacities and sources left out. */
export const DISTILLERY_FACTS: Array<{ name: string; country: string; region?: string }> = [
	{ name: 'Pulteney', country: 'Schottland', region: 'Highlands' },
	{ name: 'Aberlour', country: 'Schottland', region: 'Speyside' },
	{ name: 'Tomintoul', country: 'Schottland', region: 'Speyside' },
	{ name: 'Glen Garioch', country: 'Schottland', region: 'Highlands' },
	{ name: 'Gelephu', country: 'Bhutan' },
	{ name: 'Box', country: 'Schweden' },
	{ name: 'Arran', country: 'Schottland', region: 'Inseln' },
	{ name: 'Kilchoman', country: 'Schottland', region: 'Islay' },
	{ name: 'Balmenach', country: 'Schottland', region: 'Speyside' },
	{ name: 'Springbank', country: 'Schottland', region: 'Campbeltown' },
	{ name: 'Glenrothes', country: 'Schottland', region: 'Speyside' },
	{ name: 'BenRiach', country: 'Schottland', region: 'Speyside' },
	{ name: 'Inchgower', country: 'Schottland', region: 'Speyside' },
	{ name: 'Aultmore', country: 'Schottland', region: 'Speyside' },
	{ name: 'Ardmore', country: 'Schottland', region: 'Highlands' },
	{ name: 'Stauning Whisky', country: 'Dänemark' },
	{ name: 'The Glasgow Distillery Co.', country: 'Schottland', region: 'Lowlands' },
	{ name: 'Mackmyra', country: 'Schweden' },
	{ name: 'Nc’nean', country: 'Schottland', region: 'Highlands' },
	{ name: 'Strathearn', country: 'Schottland', region: 'Highlands' },
	{ name: 'Glen Spey', country: 'Schottland', region: 'Speyside' },
	{ name: 'Linkwood', country: 'Schottland', region: 'Speyside' },
	{ name: 'Bunnahabhain', country: 'Schottland', region: 'Islay' },
	{ name: 'Highland Park', country: 'Schottland', region: 'Inseln' },
	{ name: 'Laphroaig', country: 'Schottland', region: 'Islay' },
	{ name: 'Royal Brackla', country: 'Schottland', region: 'Highlands' },
	{ name: 'Balblair', country: 'Schottland', region: 'Highlands' },
	{ name: 'Raasay', country: 'Schottland', region: 'Inseln' },
	{ name: 'Glenallachie', country: 'Schottland', region: 'Speyside' },
	{ name: 'Ardbeg', country: 'Schottland', region: 'Islay' },
	{ name: 'Ailsa Bay', country: 'Schottland', region: 'Lowlands' },
	{ name: 'Kavalan', country: 'Taiwan' },
	{ name: 'Benromach', country: 'Schottland', region: 'Speyside' },
	{ name: 'Glenturret', country: 'Schottland', region: 'Highlands' },
	{ name: 'Jura', country: 'Schottland', region: 'Inseln' },
	{ name: 'Wolfburn', country: 'Schottland', region: 'Highlands' },
	{ name: 'Deanston', country: 'Schottland', region: 'Highlands' },
	{ name: 'Balvenie', country: 'Schottland', region: 'Speyside' },
	{ name: 'Ardnamurchan', country: 'Schottland', region: 'Highlands' },
	{ name: 'Glendullan', country: 'Schottland', region: 'Speyside' },
	{ name: 'Torabhaig', country: 'Schottland', region: 'Inseln' },
	{ name: 'Miyagikyo', country: 'Japan' },
	{ name: 'Bruichladdich', country: 'Schottland', region: 'Islay' },
	{ name: 'Bad Kötztinger Bärwurz-Quelle', country: 'Deutschland' },
	{ name: 'Caol Ila', country: 'Schottland', region: 'Islay' },
	{ name: 'Lagavulin', country: 'Schottland', region: 'Islay' },
	{ name: 'Loch Lomond', country: 'Schottland', region: 'Highlands' },
	{ name: 'Lagg', country: 'Schottland', region: 'Inseln' },
	{ name: 'Eimverk', country: 'Island' },
	{ name: 'M&H Whisky', country: 'Israel' },
	{ name: 'Edradour', country: 'Schottland', region: 'Highlands' },
	{ name: 'Talisker', country: 'Schottland', region: 'Inseln' },
	{ name: 'Ardnahoe', country: 'Schottland', region: 'Islay' },
	{ name: 'Lochlea', country: 'Schottland', region: 'Lowlands' },
	{ name: 'Lantenhammer', country: 'Deutschland' },
	{ name: 'Ben Nevis', country: 'Schottland', region: 'Highlands' },
	{ name: 'Craigellachie', country: 'Schottland', region: 'Speyside' },
	{ name: 'Teaninich', country: 'Schottland', region: 'Highlands' },
	{ name: 'Amrut', country: 'Indien' },
	{ name: 'Benrinnes', country: 'Schottland', region: 'Speyside' },
	{ name: 'Thomson Whisky New Zealand Ltd', country: 'Neuseeland' },
	{ name: 'Glenmorangie', country: 'Schottland', region: 'Highlands' },
	{ name: 'Dailuaine', country: 'Schottland', region: 'Speyside' },
	{ name: 'Glen Elgin', country: 'Schottland', region: 'Speyside' },
	{ name: 'Bladnoch', country: 'Schottland', region: 'Lowlands' },
	{ name: 'Glencadam', country: 'Schottland', region: 'Highlands' },
	{ name: 'Glen Scotia', country: 'Schottland', region: 'Campbeltown' },
	{ name: 'Tamnavulin', country: 'Schottland', region: 'Speyside' },
	{ name: 'Teerenpeli', country: 'Finnland' }
];
