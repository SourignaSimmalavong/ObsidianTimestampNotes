import { Editor, MarkdownView, Plugin, Modal, App, FileSystemAdapter, WorkspaceLeaf } from 'obsidian';
import { clipboard } from 'electron';
import ReactPlayer from 'react-player/lazy'

import { VideoView, VIDEO_VIEW } from './view/VideoView';
import { TimestampPluginSettings, TimestampPluginSettingTab, DEFAULT_SETTINGS } from 'settings';
import * as path from 'path';

const ERRORS: { [key: string]: string } = {
	"INVALID_URL": "\n> [!error] Invalid Video URL\n> The highlighted link is not a valid video url. Please try again with a valid link.\n",
	"NO_ACTIVE_VIDEO": "\n> [!caution] Select Video\n> A video needs to be opened before using this hotkey.\n Highlight your video link and input your 'Open video player' hotkey to register a video.\n",
}

export default class TimestampPlugin extends Plugin {
	settings: TimestampPluginSettings;
	player: ReactPlayer;
	setPlaying: React.Dispatch<React.SetStateAction<boolean>>;
	setPlaybackRate: React.Dispatch<React.SetStateAction<number>>;
	editor: Editor;
	last_seek: DOMHighResTimeStamp = performance.now();
	cumulated_seek_factor: number = 1;
	was_seek_forward: boolean = false;

	uriToClickLambdas: Map<string, () => void> = new Map<string, () => void>();
	urlToLeaf: Map<string, WorkspaceLeaf> = new Map<string, WorkspaceLeaf>();

	async onload() {
		// Register view
		this.registerView(
			VIDEO_VIEW,
			(leaf) => new VideoView(leaf)
		);

		// Register settings
		await this.loadSettings();

		this.registerMarkdownPostProcessor((el, ctx) => {
			const codeblocks = el.querySelectorAll("code");

			for (let index = 0; index < codeblocks.length; index++) {
				const codeblock = codeblocks.item(index);
				const text = codeblock.innerText.trim();

				const isTS = text.startsWith(":vts=");

				if (isTS) {
					const time = text.substr(5);
					console.log('extracted text ' + time);

					//create button for each timestamp
					const button = el.createEl("button");
					button.innerText = time;
					button.style.backgroundColor = this.settings.timestampColor;
					button.style.color = this.settings.timestampTextColor;
					button.style.padding = "0 5px";
					button.style.margin = "0";
					button.style.fontSize = "inherit";

					// convert timestamp to seconds and seek to that position when clicked
					button.addEventListener("click", () => {
						const timeArr = time.split(":").map((v) => parseInt(v));
						const [hh, mm, ss] = timeArr.length === 2 ? [0, ...timeArr] : timeArr;
						const seconds = (hh || 0) * 3600 + (mm || 0) * 60 + (ss || 0);
						if (this.player) this.player.seekTo(seconds);
					});
					codeblock.replaceWith(button);
				}
			}
		});

		// Markdown processor that turns timestamps into buttons
		this.registerMarkdownCodeBlockProcessor("timestamp", (source, el, ctx) => {
			// Match mm:ss or hh:mm:ss timestamp format
			const regExp = /\d+:\d+:\d+|\d+:\d+/g;
			const rows = source.split("\n").filter((row) => row.length > 0);
			rows.forEach((row) => {
				const match = row.match(regExp);
				if (match) {
					//create button for each timestamp
					const div = el.createEl("div");
					const button = div.createEl("button");
					button.innerText = match[0];
					button.style.backgroundColor = this.settings.timestampColor;
					button.style.color = this.settings.timestampTextColor;

					// convert timestamp to seconds and seek to that position when clicked
					button.addEventListener("click", () => {
						const timeArr = match[0].split(":").map((v) => parseInt(v));
						const [hh, mm, ss] = timeArr.length === 2 ? [0, ...timeArr] : timeArr;
						const seconds = (hh || 0) * 3600 + (mm || 0) * 60 + (ss || 0);
						if (this.player) this.player.seekTo(seconds);
					});
					div.appendChild(button);
				}
			})
		});


		// Markdown processor that turns video urls into buttons to open views of the video
		this.registerMarkdownCodeBlockProcessor("timestamp-url", (source, el, ctx) => {
			const tokens: string[] = source.trim().split('\n');
			if (tokens.length != 2)
			{
				return;
			}

			const displayedText = tokens[0];
			const uri = tokens[1];

			const button = el.createEl("button");
			button.innerText = "Please wait ...";
			button.style.backgroundColor = this.settings.urlColor;
			button.style.color = this.settings.urlTextColor;

			fetch(uri)
				.then(response => response.blob())
				.then(blobData => this.open_URL(URL.createObjectURL(blobData), displayedText, button, uri))
				.catch(reason => console.log("Failed to open " + uri + ": " + reason));

			this.app.workspace.on('active-leaf-change', (activeLeaf) => {
				const buttonLeaf = this.urlToLeaf.get(uri);
				
				if (activeLeaf != null)
				{	
					// @ts-ignore
					console.log(activeLeaf.id);
				}
				if (buttonLeaf != null)
				{	
					// @ts-ignore
					console.log(buttonLeaf.id);
				}
				

				if (activeLeaf != null && buttonLeaf != null)
				{
					// @ts-ignore
					if (activeLeaf.id == buttonLeaf.id)
					{
						console.log("same => refresh");
						this.refreshButton(button, uri);
					}
				}
			});

		});

		// Command that gets selected video link and sends it to view which passes it to React component
		this.addCommand({
			id: 'add-online-video-button-from-clipboard',
			name: 'Add online Video Button from clipboard',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				var clipboardText = clipboard.readText('clipboard');
				if (!clipboardText) {
					return;
				}		

				// Get selected text and match against video url to convert link to video video id
				const url = clipboardText.trim();
				
				// Activate the view with the valid link
				if (ReactPlayer.canPlay(url)) {
					this.activateOnlineView(url, editor);
					this.settings.noteTitle ?
						editor.replaceSelection("\n" + this.settings.noteTitle + "\n" + "```timestamp-url \n Title" + url + "\n ```\n") :
						editor.replaceSelection("```timestamp-url \n Title\n" + url + "\n ```\n")
					this.editor = editor;
				} else {
					editor.replaceSelection(ERRORS["INVALID_URL"])
				}
				editor.setCursor(editor.getCursor().line + 2);
				editor.focus();
			}
		});

		this.addCommand({
			id: 'open-local-video-from-clipboard',
			name: 'Open Local Video from clipboard',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.editor = editor;				
				
				let clipboardText = clipboard.readText('clipboard');
				if (!clipboardText) {
					return;
				}
				
				var relativePathURI: string = this.filepathToRelativeURI(clipboardText);
				fetch(relativePathURI)
					.then(response => response.blob())
					.then(blobData => this.activateView(URL.createObjectURL(blobData), relativePathURI, this.editor))
					.catch(reason => console.log("Failed to open " + relativePathURI + ": " + reason));

				return true;
			}
		});

		this.addCommand({
			id: 'add-local-video-button-from-clipboard',
			name: 'Add Local Video Button from clipboard',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.editor = editor;				

				var clipboardText = clipboard.readText('clipboard');
				if (!clipboardText) {
					return;
				}		

				var filename: string = "";
				if (clipboardText.contains("\\"))
				{
					filename = clipboardText.substring(clipboardText.lastIndexOf("\\") + 1);
				}
				else
				{
					filename = clipboardText.substring(clipboardText.lastIndexOf("/") + 1);
				}
				var relativeFileURI: string = this.filepathToRelativeURI(clipboardText);
				editor.replaceSelection("```timestamp-url \n" + filename + "\n" + relativeFileURI + "\n```\n");

				return true;
			}
		});

		// This command inserts the timestamp of the playing video into the editor
		this.addCommand({
			id: 'timestamp-insert',
			name: 'Insert timestamp based on videos current play time',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				if (!this.player) {
					editor.replaceSelection(ERRORS["NO_ACTIVE_VIDEO"])
					return
				}

				// convert current video time into timestamp
				const leadingZero = (num: number) => num < 10 ? "0" + num.toFixed(0) : num.toFixed(0);
				const totalSeconds = Number(this.player.getCurrentTime().toFixed(2));
				const hours = Math.floor(totalSeconds / 3600);
				const minutes = Math.floor((totalSeconds - (hours * 3600)) / 60);
				const seconds = totalSeconds - (hours * 3600) - (minutes * 60);
				const time = (hours > 0 ? leadingZero(hours) + ":" : "") + leadingZero(minutes) + ":" + leadingZero(seconds);

				// insert timestamp into editor
				editor.replaceSelection("```timestamp \n " + time + "\n```\n")
			}
		});

		this.addCommand({
			id: 'timestamp-insert-inline',
			name: 'Insert inline timestamp based on videos current play time',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				if (!this.player) {
					editor.replaceSelection(ERRORS["NO_ACTIVE_VIDEO"])
					return
				}

				// convert current video time into timestamp
				const leadingZero = (num: number) => num < 10 ? "0" + num.toFixed(0) : num.toFixed(0);
				const totalSeconds = Number(this.player.getCurrentTime().toFixed(2));
				const hours = Math.floor(totalSeconds / 3600);
				const minutes = Math.floor((totalSeconds - (hours * 3600)) / 60);
				const seconds = totalSeconds - (hours * 3600) - (minutes * 60);
				const time = (hours > 0 ? leadingZero(hours) + ":" : "") + leadingZero(minutes) + ":" + leadingZero(seconds);

				// insert timestamp into editor
				editor.replaceSelection("`:vts=" + time + "`")
			}
		});

		//Command that play/pauses the video
		this.addCommand({
			id: 'play-pause-player',
			name: 'Play / Pause player',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.setPlaying(!this.player.props.playing)
			}
		});

		// Go back to the beginning of the video.
		this.addCommand({
			id: 'restart-video',
			name: 'Restart video',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				if (this.player) 
				{
					this.player.seekTo(0);
				}
			}
		});

		// Seek forward by set amount of seconds
		this.addCommand({
			id: 'seek-forward',
			name: 'Seek Forward',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				if (this.player) 
				{
					var new_seek_timestamp = window.performance.now();
					var forward_seek: number = parseInt(this.settings.forwardSeek);
					if ((new_seek_timestamp - this.last_seek) < parseInt(this.settings.seekRepeatResetTime) && this.was_seek_forward)
					{
						this.cumulated_seek_factor *= Math.min(parseFloat(this.settings.seekFactor), parseFloat(this.settings.maxCumulatedSeekFactor));
					}
					else
					{
						this.cumulated_seek_factor = 1;
					}
					forward_seek *= this.cumulated_seek_factor;
					this.last_seek = new_seek_timestamp;
					this.was_seek_forward = true;

					this.player.seekTo(this.player.getCurrentTime() + forward_seek);
				}
			}
		});

		// Seek backwards by set amount of seconds
		this.addCommand({
			id: 'seek-backward',
			name: 'Seek Backward',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				if (this.player)
				{
					var new_seek_timestamp = window.performance.now();
					var backward_seek: number = parseInt(this.settings.backwardsSeek);
					if ((new_seek_timestamp - this.last_seek) < parseInt(this.settings.seekRepeatResetTime) && !this.was_seek_forward)
					{
						this.cumulated_seek_factor *= Math.min(parseFloat(this.settings.seekFactor), parseFloat(this.settings.maxCumulatedSeekFactor));
					}
					else
					{
						this.cumulated_seek_factor = 1;
					}
					backward_seek *= this.cumulated_seek_factor;
					this.last_seek = new_seek_timestamp;
					this.was_seek_forward = false;

					this.player.seekTo(this.player.getCurrentTime() - backward_seek);
				}
			}
		});

		// Increase youtube player playback speed
		this.addCommand({
			id: 'increase-play-speed',
			name: 'Increase Play Speed',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				if (this.player) 
				{
					if(this.player.props.playbackRate < 10)
					{
						var speedFactor: number = parseFloat(this.settings.speedFactor);
						if(this.player.props.playbackRate > speedFactor)
						{
							this.setPlaybackRate(this.player.props.playbackRate + speedFactor);
						}
					}
				}
			}
		});

		// Decrease youtube player playback speed
		this.addCommand({
			id: 'decrease-play-speed',
			name: 'Decrease Play Speed',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				if (this.player) 
				{
					var speedFactor: number = parseFloat(this.settings.speedFactor);
					if(this.player.props.playbackRate > speedFactor)
					{
						this.setPlaybackRate(this.player.props.playbackRate - speedFactor);
					}
				}
			}
		});

		// Reset youtube player playback speed
		this.addCommand({
			id: 'reset-play-speed',
			name: 'Reset Play Speed',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				if (this.player) 
				{
					this.setPlaybackRate(1);
				}
			}
		});

		// This adds a complex command that can check whether the current state of the app allows execution of the command
		this.addCommand({
			id: 'open-local-video-dialog',
			name: 'Open Local Video (Dialog)',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.editor = editor;
				new OpenLocalVideoModal(this.app, this.activateView.bind(this), editor).open();
				// This command will only show up in Command Palette when the check function returns true
				return true;
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new TimestampPluginSettingTab(this.app, this));
	}

	async onunload() {
		this.player = null;
		this.editor = null;
		this.setPlaying = null;
		this.setPlaybackRate = null;
		this.app.workspace.detachLeavesOfType(VIDEO_VIEW);
	}

	// This is called when a valid url is found => it activates the View which loads the React view
	async activateOnlineView(url: string, editor: Editor) {
		this.app.workspace.detachLeavesOfType(VIDEO_VIEW);

		await this.app.workspace.getRightLeaf(false).setViewState({
			type: VIDEO_VIEW,
			active: true,
		});

		this.app.workspace.revealLeaf(
			this.app.workspace.getLeavesOfType(VIDEO_VIEW)[0]
		);

		// This triggers the React component to be loaded
		this.app.workspace.getLeavesOfType(VIDEO_VIEW).forEach(async (leaf) => {
			if (leaf.view instanceof VideoView) {

				const setupPlayer = (player: ReactPlayer, setPlaying: React.Dispatch<React.SetStateAction<boolean>>, setPlaybackRate: React.Dispatch<React.SetStateAction<number>>) => {
					this.player = player;
					this.setPlaying = setPlaying;
					this.setPlaybackRate = setPlaybackRate;
				}

				const setupError = (err: string) => {
					editor.replaceSelection(editor.getSelection() + `\n> [!error] Streaming Error \n> ${err}\n`);
				}

				const saveTimeOnUnload = async () => {
					if (this.player) {
						this.settings.urlStartTimeMap.set(url, Number(this.player.getCurrentTime().toFixed(0)));
					}
					await this.saveSettings();
				}

				// create a new video instance, sets up state/unload functionality, and passes in a start time if available else 0
				leaf.setEphemeralState({
					url,
					setupPlayer,
					setupError,
					saveTimeOnUnload,
					start: ~~this.settings.urlStartTimeMap.get(url)
				});

				await this.saveSettings();
			}
		});
	}

	// This is called when a valid url is found => it activates the View which loads the React view
	async activateView(blobURL: string, uri: string, editor: Editor, button?: HTMLButtonElement) {
		if (this.settings.openInRightPane)
		{
			this.app.workspace.detachLeavesOfType(VIDEO_VIEW);

			await this.app.workspace.getRightLeaf(false).setViewState({
				type: VIDEO_VIEW,
				active: true,
			});
		}
		else{
			this.app.workspace.detachLeavesOfType(VIDEO_VIEW);

			await this.app.workspace.getLeaf(true).setViewState({
				type: VIDEO_VIEW,
				active: false,
			});
		}

		this.app.workspace.revealLeaf(
			this.app.workspace.getLeavesOfType(VIDEO_VIEW)[0]
		);

		// This triggers the React component to be loaded
		this.app.workspace.getLeavesOfType(VIDEO_VIEW).forEach(async (leaf) => {
			if (leaf.view instanceof VideoView) {

				const setupPlayer = (player: ReactPlayer, setPlaying: React.Dispatch<React.SetStateAction<boolean>>, setPlaybackRate: React.Dispatch<React.SetStateAction<number>>) => {
					this.player = player;
					this.setPlaying = setPlaying;
					this.setPlaybackRate = setPlaybackRate;
				}

				const setupError = (err: string) => {
					console.log(`[!error] Streaming Error \n> ${err}`);
					if (button)
					{
						this.refreshButton(button, uri);

						// Enforce the click of the button to reopen the video with a correct blob url.
						if (this.uriToClickLambdas.has(uri))
						{
							// const f: () => void = this.uriToClickLambdas.get(uri);
							// f.apply(this);
						}
					}
					// editor.replaceSelection(editor.getSelection() + `\n> [!error] Streaming Error \n> ${err}\n`);
				}

				const saveTimeOnUnload = async () => {
					if (this.player) {
						this.settings.urlStartTimeMap.set(blobURL, Number(this.player.getCurrentTime().toFixed(0)));
					}

					if (button)
					{
						this.refreshButton(button, uri);
					}

					await this.saveSettings();
				}

				// create a new video instance, sets up state/unload functionality, and passes in a start time if available else 0
				leaf.setEphemeralState({
					url: blobURL,
					setupPlayer,
					setupError,
					saveTimeOnUnload,
					start: ~~this.settings.urlStartTimeMap.get(blobURL)
				});

				await this.saveSettings();
			}
		});
	}

	async loadSettings() {
		// Fix for a weird bug that turns default map into a normal object when loaded
		const data = await this.loadData()
		if (data) {
			const map = new Map(Object.keys(data.urlStartTimeMap).map(k => [k, data.urlStartTimeMap[k]]))
			this.settings = { ...DEFAULT_SETTINGS, ...data, urlStartTimeMap: map };
		} else {
			this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	open_URL(blobURL: string, displayedText: string, button: HTMLButtonElement, uri: string){
		if (ReactPlayer.canPlay(blobURL)) {
			// Creates button for video url
			// const div = el.createEl("div");
			// const button = div.createEl("button");
			// button.innerText = display_text;
			// button.style.backgroundColor = this.settings.urlColor;
			// button.style.color = this.settings.urlTextColor;

			// button.addEventListener("click", () => {
			// 	this.activateView(url, this.editor);
			// });
			button.innerText = displayedText;
			this.uriToClickLambdas.set(uri, this.createLambdaFromURI(uri, blobURL, button));
			button.addEventListener("click", this.uriToClickLambdas.get(uri));
		} else {
			if (this.editor) {
				console.log(ERRORS["INVALID_URL"]);
				//this.editor.replaceSelection(this.editor.getSelection() + "\n" + ERRORS["INVALID_URL"]);
			}
		}

	}

	getVaulteAbsolutePath(app: App){
		let adapter = app.vault.adapter;
		if (adapter instanceof FileSystemAdapter) {
			return adapter.getBasePath();
		}
		return null;
	}

	filepathToRelativeURI(filepath: string) : string{
		var vaultAbsolutePath: string = this.getVaulteAbsolutePath(this.app);
		var serverRoot: string = path.join(vaultAbsolutePath, this.settings.serverRoot);

		var serverRootURI: string = this.pathToUri(serverRoot);
		var fileURI: string = "";
		if (path.isAbsolute(filepath))
		{
			fileURI = this.pathToUri(filepath);
		}
		else
		{
			// Assume it is a path within the vault?
			fileURI = path.join(vaultAbsolutePath, filepath);
			fileURI = this.pathToUri(fileURI);
		}

		var relativeFileURI: string = fileURI.replace(serverRootURI, "");
		relativeFileURI = "http://localhost:" + this.settings.serverPort + relativeFileURI;

		return relativeFileURI;
	}

	createLambdaFromURI(uri: string, blobURL: string, button: HTMLButtonElement)
	{
		return () => {
			if (!this.urlToLeaf.has(uri))
			{
				if (this.app.workspace.activeLeaf)
				{
					// Any cleaner way to do that?
					// @ts-ignore
					this.urlToLeaf.set(uri, this.app.workspace.activeLeaf);
				}
				else{
					console.log("Could not fetch the active leaf id.");
					return;
				}
			}

			this.activateView(blobURL, uri, this.editor, button);
		};
	}

	async refreshButton(button : HTMLButtonElement, uri: string){
		const displayedText: string = button.innerText;
		button.innerText = "Please wait ...";
		console.log("Please wait ...");
		fetch(uri)
			.then(response => response.blob())
			.then(blobData => {
				button.innerText = displayedText; 
				button.removeEventListener('click', this.uriToClickLambdas.get(uri));
				const newBlobURL: string = URL.createObjectURL(blobData);
				this.uriToClickLambdas.set(uri, this.createLambdaFromURI(uri, newBlobURL, button));
				button.addEventListener("click", this.uriToClickLambdas.get(uri));
				console.log("button refreshed");
			});
	}

	/////////////////////////////////////////////////////
	// Code to convert path to URI "stolen" from https://github.com/MichalBures/obsidian-file-path-to-uri/blob/master/main.ts

	/**
	 * Does the text have any '\' or '/'?
	 */
	hasSlashes(text: string) {
		// Does it have any '\' or '/'?
		const regexHasAnySlash = /.*([\\\/]).*/g;

		if (typeof text !== 'string') {
			return false;
		}

		let matches = text.match(regexHasAnySlash);
		return !!matches;
	}

	/**
	 * Trim whitespace and remove surrounding "
	 */
	cleanupText(text: string) {
		if (typeof text !== 'string') {
			return '';
		}

		text = text.trim();

		// Remove surrounding "
		if (text.startsWith('"')) {
			text = text.substr(1);
		}
		if (text.endsWith('"')) {
			text = text.substr(0, text.length - 1);
		}

		return text;
	}

	pathToUri(pathURL: string) : string {
		pathURL = this.cleanupText(pathURL);

		// Paste the text as usual if it's not file path
		if (pathURL.startsWith('file:') || !this.hasSlashes(pathURL)) {
			return pathURL;
		}

		// network path '\\path'
		if (pathURL.startsWith('\\\\')) {
			let endsWithSlash =
				pathURL.endsWith('\\') || pathURL.endsWith('/');
			// URL throws error on invalid url
			try {
				let url = new URL(pathURL);

				let link = url.href.replace('file://', 'file:///%5C%5C');
				if (link.endsWith('/') && !endsWithSlash) {
					link = link.slice(0, -1);
				}

				return link;
			} catch (e) {
				return;
			}
		}
		// path C:\Users\ or \System\etc
		else {
			if (!this.hasSlashes(pathURL)) {
				return;
			}

			// URL throws error on invalid url
			try {
				let url = new URL('file://' + pathURL);
				return url.href;
				// this.editor.replaceSelection(url.href, 'around');
			} catch (e) {
				return;
			}
		}
	}

	// End of stolen code.
	////////////////////////////////////////////////////

}

class OpenLocalVideoModal extends Modal {
	editor: Editor;
	activateView: (url: string, editor: Editor) => void;
	constructor(app: App, activateView: (url: string, editor: Editor) => void, editor: Editor) {
		super(app);
		this.activateView = activateView;
		this.editor = editor;
	}

	onOpen() {
		const { contentEl } = this;
		// add an input field to contentEl

		const input = contentEl.createEl('input');
		input.setAttribute("type", "file");
		input.onchange = (e: any) => {
			// accept local video input and make a url from input
			const url = URL.createObjectURL(e.target.files[0]);
			this.activateView(url, this.editor);

			// Can't get the buttons to work with local videos unfortunately
			// this.editor.replaceSelection("\n" + "```timestamp-url \n " + url.trim() + "\n ```\n")
			this.close();
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
