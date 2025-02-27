import { chat_metadata, saveSettingsDebounced } from "../../../script.js";
import { extension_settings, getContext } from "../../extensions.js";
import { debounce } from "../../utils.js";
export { MODULE_NAME };

const saveMetadataDebounced = debounce(async () => await getContext().saveMetadata(), 1000);

const MODULE_NAME = '2_floating_prompt'; // <= Deliberate, for sorting lower than memory
const UPDATE_INTERVAL = 1000;

const DEFAULT_DEPTH = 4;
const DEFAULT_POSITION = 1;
const DEFAULT_INTERVAL = 1;

const metadata_keys = {
    prompt: 'note_prompt',
    interval: 'note_interval',
    depth: 'note_depth',
    position: 'note_position',
}

async function onExtensionFloatingPromptInput() {
    chat_metadata[metadata_keys.prompt] = $(this).val();
    saveMetadataDebounced();
}

async function onExtensionFloatingIntervalInput() {
    chat_metadata[metadata_keys.interval] = Number($(this).val());
    saveMetadataDebounced();
}

async function onExtensionFloatingDepthInput() {
    let value = Number($(this).val());

    if (value < 0) {
        value = Math.abs(value);
        $(this).val(value);
    }

    chat_metadata[metadata_keys.depth] = value;
    saveMetadataDebounced();
}

async function onExtensionFloatingPositionInput(e) {
    chat_metadata[metadata_keys.position] = e.target.value;
    saveMetadataDebounced();
}

function onExtensionFloatingDefaultInput() {
    extension_settings.note.default = $(this).val();
    saveSettingsDebounced();
}

function loadSettings() {
    chat_metadata[metadata_keys.prompt] = chat_metadata[metadata_keys.prompt] ?? extension_settings.note.default ?? '';
    chat_metadata[metadata_keys.interval] = chat_metadata[metadata_keys.interval] ?? DEFAULT_INTERVAL;
    chat_metadata[metadata_keys.position] = chat_metadata[metadata_keys.position] ?? DEFAULT_POSITION;
    chat_metadata[metadata_keys.depth] = chat_metadata[metadata_keys.depth] ?? DEFAULT_DEPTH;
    $('#extension_floating_prompt').val(chat_metadata[metadata_keys.prompt]);
    $('#extension_floating_interval').val(chat_metadata[metadata_keys.interval]);
    $('#extension_floating_depth').val(chat_metadata[metadata_keys.depth]);
    $(`input[name="extension_floating_position"][value="${chat_metadata[metadata_keys.position]}"]`).prop('checked', true);
    $('#extension_floating_default').val(extension_settings.note.default);
}

let isWorkerBusy = false;

async function moduleWorkerWrapper() {
    // Don't touch me I'm busy...
    if (isWorkerBusy) {
        return;
    }

    // I'm free. Let's update!
    try {
        isWorkerBusy = true;
        await moduleWorker();
    }
    finally {
        isWorkerBusy = false;
    }
}

async function moduleWorker() {
    const context = getContext();

    if (!context.groupId && context.characterId === undefined) {
        return;
    }

    loadSettings();

    // take the count of messages
    let lastMessageNumber = Array.isArray(context.chat) && context.chat.length ? context.chat.filter(m => m.is_user).length : 0;

    // special case for new chat
    if (Array.isArray(context.chat) && context.chat.length === 1) {
        lastMessageNumber = 1;
    }

    if (lastMessageNumber <= 0 || chat_metadata[metadata_keys.interval] <= 0) {
        context.setExtensionPrompt(MODULE_NAME, '');
        $('#extension_floating_counter').text('No');
        return;
    }

    const messagesTillInsertion = lastMessageNumber >= chat_metadata[metadata_keys.interval]
        ? (lastMessageNumber % chat_metadata[metadata_keys.interval])
        : (chat_metadata[metadata_keys.interval] - lastMessageNumber);
    const shouldAddPrompt = messagesTillInsertion == 0;
    const prompt = shouldAddPrompt ? $('#extension_floating_prompt').val() : '';
    context.setExtensionPrompt(MODULE_NAME, prompt, chat_metadata[metadata_keys.position], chat_metadata[metadata_keys.depth]);
    $('#extension_floating_counter').text(shouldAddPrompt ? 'This' : messagesTillInsertion);
}

(function () {
    function addExtensionsSettings() {
        const settingsHtml = `
        <div class="floating_prompt_settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>作者偏见 / 逻辑歧视</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <small>
                    你的笔记是按照 <b>每次聊天</b>来保存的。当你开始一次新的聊天时，你会看到默认的/空的笔记。<br>
                    保存书签会将你的笔记复制到一个书签聊天中。对它进行修改不会更新父聊天中的笔记。<br>
                </small>
                <label for="extension_floating_prompt">追加以下文本:</label>
                <textarea id="extension_floating_prompt" class="text_pole" rows="8"></textarea>
                <div class="floating_prompt_radio_group">
                    <label>
                        <input type="radio" name="extension_floating_position" value="0" />
                        场景后
                    </label>
                    <label>
                        <input type="radio" name="extension_floating_position" value="1" />
                        对话中
                    </label>
                </div>
                <label for="extension_floating_interval">每N条消息 <b>你</b> 发送的 (设置0为关闭):</label>
                <input id="extension_floating_interval" class="text_pole" type="number" min="0" max="999" />
                <label for="extension_floating_interval">插入深度 (用于聊天中定位):</label>
                <input id="extension_floating_depth" class="text_pole" type="number" min="0" max="99" />
                <span>附加到下一个请求: <span id="extension_floating_counter">无</span> 消息</span>
                </div>
            </div>
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>新聊天的默认标注</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <label for="extension_floating_default">默认作者标记</label>
                    <textarea id="extension_floating_default" class="text_pole" rows="8"
                    placeholder="例如:\n[Scenario: wacky adventures; Genre: romantic comedy; Style: verbose, creative]"></textarea>
                </div>
            </div>
        </div>
        `;

        $('#extensions_settings').append(settingsHtml);
        $('#extension_floating_prompt').on('input', onExtensionFloatingPromptInput);
        $('#extension_floating_interval').on('input', onExtensionFloatingIntervalInput);
        $('#extension_floating_depth').on('input', onExtensionFloatingDepthInput);
        $('#extension_floating_default').on('input', onExtensionFloatingDefaultInput);
        $('input[name="extension_floating_position"]').on('change', onExtensionFloatingPositionInput);
    }

    addExtensionsSettings();
    setInterval(moduleWorkerWrapper, UPDATE_INTERVAL);
})();