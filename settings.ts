import { App, PluginSettingTab, Setting } from 'obsidian';
import TimestampPlugin from './main';

export interface TimestampPluginSettings {
	noteTitle: string;
	urlStartTimeMap: Map<string, number>;
	urlColor: string;
	timestampColor: string;
	urlTextColor: string;
	timestampTextColor: string;
	forwardSeek: string;
	backwardsSeek: string;
	seekFactor: string;
	seekRepeatResetTime: string;
	maxCumulatedSeekFactor: string;
	speedFactor: string;
}

export const DEFAULT_SETTINGS: TimestampPluginSettings = {
	noteTitle: "",
	urlStartTimeMap: new Map<string, number>(),
	urlColor: '#277ab5',
	timestampColor: '#27b59d',
	urlTextColor: 'white',
	timestampTextColor: 'white',
	forwardSeek: '1',
	backwardsSeek: '1',
	seekFactor: '1.5',
	seekRepeatResetTime: '500',
	maxCumulatedSeekFactor: '300',
	speedFactor: '0.10',
}

const COLORS = { 'blue': 'blue', 'red': 'red', 'green': 'green', 'yellow': 'yellow', 'orange': 'orange', 'purple': 'purple', 'pink': 'pink', 'grey': 'grey', 'black': 'black', 'white': 'white' };
const COLORS_VALUES = ['blue', 'red', 'green',  'yellow',  'orange',  'purple', 'pink',  'grey', 'black', 'white' ];

const TIMES = { '1': '1', '2': '2', '3': '3', '4':'4', '5': '5', '10': '10', '15': '15', '20': '20', '25': '25', '30': '30', '35': '35', '40': '40', '45': '45', '50': '50', '55': '55', '60': '60', '65': '65', '70': '70', '75': '75', '80': '80', '85': '85', '90': '90', '95': '95', '100': '100', '105': '105', '110': '110', '115': '115', '120': '120' }

export class TimestampPluginSettingTab extends PluginSettingTab {
	plugin: TimestampPlugin;

	constructor(app: App, plugin: TimestampPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	is_hex_digit(digit: string): Boolean {
		return digit >= '0' && digit <= '9' || digit.toLowerCase() >= 'a' && digit.toLowerCase() <= 'f'
	}

	is_valid_hex_color(color: string): boolean {
		if (color.length != 7)
		{
			return false
		}

		for (var i: number = 1; i < color.length; i++)
		{
			if (!this.is_hex_digit(color[i]))
			{
				return false
			}
		}
		return color[0] == '#'
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl('h2', { text: 'Timestamp Notes Plugin' });

		// Customize title
		new Setting(containerEl)
			.setName('Title')
			.setDesc('This title will be printed after opening a video with the hotkey. Use <br> for new lines.')
			.addText(text => text
				.setPlaceholder('Enter title template.')
				.setValue(this.plugin.settings.noteTitle)
				.onChange(async (value) => {
					this.plugin.settings.noteTitle = value;
					await this.plugin.saveSettings();
				}));

		// Customize  url button color
		new Setting(containerEl)
			.setName('URL Button Color')
			.setDesc('Pick a color for the url button.')
			.addText(text => text
				.setPlaceholder('Enter hex color or color name.')
				.setValue(this.plugin.settings.urlColor)
				.onChange(async (value) => {
					if (this.is_valid_hex_color(value) || COLORS_VALUES.includes(value))
					{
						this.plugin.settings.urlColor = value;
						await this.plugin.saveSettings();
					}
				}));

		// Customize url text color
		new Setting(containerEl)
			.setName('URL Text Color')
			.setDesc('Pick a color for the URL text button.')
			.addText(text => text
				.setPlaceholder('Enter hex color or color name.')
				.setValue(this.plugin.settings.urlTextColor)
				.onChange(async (value) => {
					if (this.is_valid_hex_color(value) || COLORS_VALUES.includes(value))
					{
						this.plugin.settings.urlTextColor = value;
						await this.plugin.saveSettings();
					}
				}));

		// Customize timestamp button color
		new Setting(containerEl)
			.setName('Timestamp Button Color')
			.setDesc('Pick a color for the timestamp button.')
			.addText(text => text
				.setPlaceholder('Enter hex color or color name.')
				.setValue(this.plugin.settings.timestampColor)
				.onChange(async (value) => {
					if (this.is_valid_hex_color(value) || COLORS_VALUES.includes(value))
					{
						this.plugin.settings.timestampColor = value;
						await this.plugin.saveSettings();
					}
				}));

		// Customize timestamp text color
		new Setting(containerEl)
			.setName('Timestamp Text Color')
			.setDesc('Pick a color for the timestamp text.')
			.addText(text => text
				.setPlaceholder('Enter hex color or color name.')
				.setValue(this.plugin.settings.timestampTextColor)
				.onChange(async (value) => {
					if (this.is_valid_hex_color(value) || COLORS_VALUES.includes(value))
					{
						this.plugin.settings.timestampTextColor = value;
						await this.plugin.saveSettings();
					}
				}));

		// Customize forward seek time
		new Setting(containerEl)
			.setName('Foward time seek')
			.setDesc('This is the amount of seconds the video will seek forward when pressing the seek forward command.')
			.addDropdown(dropdown => dropdown
				.addOptions(TIMES)
				.setValue(this.plugin.settings.forwardSeek)
				.onChange(async (value) => {
					this.plugin.settings.forwardSeek = value;
					await this.plugin.saveSettings();
				}
				));

		// Customize backwards seek time
		new Setting(containerEl)
			.setName('Backwards time seek')
			.setDesc('This is the amount of seconds the video will seek backwards when pressing the seek backwards command.')
			.addDropdown(dropdown => dropdown
				.addOptions(TIMES)
				.setValue(this.plugin.settings.backwardsSeek)
				.onChange(async (value) => {
					this.plugin.settings.backwardsSeek = value;
					await this.plugin.saveSettings();
				}
				));

		// Customize seek factor
		new Setting(containerEl)
			.setName('Seek factor')
			.setDesc('Represent how fast the seek goes when calling "forward seek" or "backward seek" quickly in a row.')
			.addText(text => text
				.setPlaceholder('Enter a floating number')
				.setValue(this.plugin.settings.seekFactor)
				.onChange(async (value) => {
					this.plugin.settings.seekFactor = value;
					await this.plugin.saveSettings();
				}));

		// Customize seek repeat reset time
		new Setting(containerEl)
			.setName('Seek repeat reset time')
			.setDesc('Determine how fast (in ms) the seek multiplier will reset.')
			.addText(text => text
				.setPlaceholder('Enter an integral number')
				.setValue(this.plugin.settings.seekRepeatResetTime)
				.onChange(async (value) => {
					this.plugin.settings.seekRepeatResetTime = value;
					await this.plugin.saveSettings();
				}));

		// Customize seek repeat reset time
		new Setting(containerEl)
			.setName('Maximum cumulated seek factor')
			.setDesc('Determine the maximum seek value.')
			.addText(text => text
				.setPlaceholder('Enter a floating number')
				.setValue(this.plugin.settings.maxCumulatedSeekFactor)
				.onChange(async (value) => {
					this.plugin.settings.maxCumulatedSeekFactor = value;
					await this.plugin.saveSettings();
				}));


		// Customize speed factor
		new Setting(containerEl)
			.setName('Speed factor')
			.setDesc('This is the percentage of speed added or subtracted to current speed playback.')
			.addText(text => text
				.setPlaceholder('Enter a number')
				.setValue(this.plugin.settings.speedFactor)
				.onChange(async (value) => {
					this.plugin.settings.speedFactor = value;
					await this.plugin.saveSettings();
				}));
	
	}
}