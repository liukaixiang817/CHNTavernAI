import {
    shuffle,
    onlyUnique,
    debounce,
    delay,
} from './utils.js';
import { RA_CountCharTokens, humanizedDateTime } from "./RossAscends-mods.js";
import { sortCharactersList, sortGroupMembers } from './power-user.js';

import {
    chat,
    sendSystemMessage,
    printMessages,
    substituteParams,
    characters,
    default_avatar,
    addOneMessage,
    callPopup,
    clearChat,
    Generate,
    select_rm_info,
    setCharacterId,
    setCharacterName,
    setEditedMessageId,
    is_send_press,
    name1,
    resetChatState,
    setSendButtonState,
    getCharacters,
    system_message_types,
    online_status,
    talkativeness_default,
    selectRightMenuWithAnimation,
    setRightTabSelectedClass,
    default_ch_mes,
    deleteLastMessage,
    showSwipeButtons,
    hideSwipeButtons,
    chat_metadata,
    updateChatMetadata,
    isStreamingEnabled,
    getThumbnailUrl,
    streamingProcessor,
    getRequestHeaders,
    setMenuType,
    menu_type,
    select_selected_character,
    cancelTtsPlay,
    isMultigenEnabled,
} from "../script.js";
import { appendTagToList, createTagMapFromList, getTagsList, applyTagsOnCharacterSelect } from './tags.js';

export {
    selected_group,
    is_group_automode_enabled,
    is_group_generating,
    group_generation_id,
    groups,
    saveGroupChat,
    generateGroupWrapper,
    deleteGroup,
    getGroupAvatar,
    getGroups,
    printGroups,
    regenerateGroup,
    resetSelectedGroup,
    select_group_chats,
}

let is_group_generating = false; // Group generation flag
let is_group_automode_enabled = false;
let groups = [];
let selected_group = null;
let group_generation_id = null;
let fav_grp_checked = false;
let fav_filter_on = false;

export const group_activation_strategy = {
    NATURAL: 0,
    LIST: 1,
};

const groupAutoModeInterval = setInterval(groupChatAutoModeWorker, 5000);
const saveGroupDebounced = debounce(async (group) => await _save(group), 500);

async function _save(group, reload = true) {
    await fetch("/editgroup", {
        method: "POST",
        headers: getRequestHeaders(),
        body: JSON.stringify(group),
    });
    if (reload) {
        await getCharacters();
    }
}

// Group chats
async function regenerateGroup() {
    let generationId = getLastMessageGenerationId();

    while (chat.length > 0) {
        const lastMes = chat[chat.length - 1];
        const this_generationId = lastMes.extra?.gen_id;

        // for new generations after the update
        if ((generationId && this_generationId) && generationId !== this_generationId) {
            break;
        }
        // legacy for generations before the update
        else if (lastMes.is_user || lastMes.is_system) {
            break;
        }

        deleteLastMessage();
    }

    generateGroupWrapper();
}

async function loadGroupChat(chatId) {
    const response = await fetch("/getgroupchat", {
        method: "POST",
        headers: getRequestHeaders(),
        body: JSON.stringify({ id: chatId }),
    });

    if (response.ok) {
        const data = await response.json();
        return data;
    }

    return [];
}

export async function getGroupChat(groupId) {
    const group = groups.find((x) => x.id === groupId);
    const chat_id = group.chat_id;
    const data = await loadGroupChat(chat_id);

    if (Array.isArray(data) && data.length) {
        data[0].is_group = true;
        for (let key of data) {
            chat.push(key);
        }
        printMessages();
    } else {
        sendSystemMessage(system_message_types.GROUP);
        if (group && Array.isArray(group.members)) {
            for (let member of group.members) {
                const character = characters.find(x => x.avatar === member || x.name === member);

                if (!character) {
                    continue;
                }

                const mes = getFirstCharacterMessage(character);
                chat.push(mes);
                addOneMessage(mes);
            }
        }
    }

    if (group) {
        let metadata = group.chat_metadata ?? {};
        updateChatMetadata(metadata, true);
    }

    await saveGroupChat(groupId, true);
}

function getFirstCharacterMessage(character) {
    const mes = {};
    mes["is_user"] = false;
    mes["is_system"] = false;
    mes["name"] = character.name;
    mes["is_name"] = true;
    mes["send_date"] = humanizedDateTime();
    mes["mes"] = character.first_mes
        ? substituteParams(character.first_mes.trim(), name1, character.name)
        : default_ch_mes;
    mes["force_avatar"] =
        character.avatar != "none"
            ? getThumbnailUrl('avatar', character.avatar)
            : default_avatar;
    return mes;
}

function resetSelectedGroup() {
    selected_group = null;
    is_group_generating = false;
}

async function saveGroupChat(groupId, shouldSaveGroup) {
    const group = groups.find(x => x.id == groupId);
    const chat_id = group.chat_id;
    group['date_last_chat'] = Date.now();
    const response = await fetch("/savegroupchat", {
        method: "POST",
        headers: getRequestHeaders(),
        body: JSON.stringify({ id: chat_id, chat: [...chat] }),
    });

    if (shouldSaveGroup && response.ok) {
        await editGroup(groupId);
    }
    sortCharactersList();
}

export async function renameGroupMember(oldAvatar, newAvatar, newName) {
    // Scan every group for our renamed character
    for (const group of groups) {
        try {
            // Try finding the member by old avatar link
            const memberIndex = group.members.findIndex(x => x == oldAvatar);

            // Character was not present in the group...
            if (memberIndex == -1) {
                continue;
            }

            // Replace group member avatar id and save the changes
            group.members[memberIndex] = newAvatar;
            await editGroup(group.id, true);
            console.log(`Renamed character ${newName} in group: ${group.name}`)

            // Load all chats from this group
            for (const chatId of group.chats) {
                const messages = await loadGroupChat(chatId);

                // Only save the chat if there were any changes to the chat content
                let hadChanges = false;
                // Chat shouldn't be empty
                if (Array.isArray(messages) && messages.length) {
                    // Iterate over every chat message
                    for (const message of messages) {
                        // Only look at character messages
                        if (message.is_user || message.is_system) {
                            continue;
                        }

                        // Message belonged to the old-named character:
                        // Update name, avatar thumbnail URL and original avatar link
                        if (message.force_avatar && message.force_avatar.indexOf(encodeURIComponent(oldAvatar)) !== -1) {
                            message.name = newName;
                            message.force_avatar = message.force_avatar.replace(encodeURIComponent(oldAvatar), encodeURIComponent(newAvatar));
                            message.original_avatar = newAvatar;
                            hadChanges = true;
                        }
                    }

                    if (hadChanges) {
                        const saveChatResponse = await fetch("/savegroupchat", {
                            method: "POST",
                            headers: getRequestHeaders(),
                            body: JSON.stringify({ id: chatId, chat: [...messages] }),
                        });

                        if (saveChatResponse.ok) {
                            console.log(`Renamed character ${newName} in group chat: ${chatId}`);
                        }
                    }
                }
            }
        }
        catch (error) {
            console.log(`An error during renaming the character ${newName} in group: ${group.name}`);
            console.error(error);
        }
    }
}

async function getGroups() {
    const response = await fetch("/getgroups", {
        method: "POST",
        headers: getRequestHeaders()
    });

    if (response.ok) {
        const data = await response.json();
        groups = data.sort((a, b) => a.id - b.id);

        // Convert groups to new format
        for (const group of groups) {
            if (group.chat_id == undefined) {
                group.chat_id = group.id;
                group.chats = [group.id];
                group.members = group.members
                    .map(x => characters.find(y => y.name == x)?.avatar)
                    .filter(x => x)
                    .filter(onlyUnique)
            }
            if (group.past_metadata == undefined) {
                group.past_metadata = {};
            }
        }
    }
}

function printGroups() {
    for (let group of groups) {
        const template = $("#group_list_template .group_select").clone();
        template.data("id", group.id);
        template.attr("grid", group.id);
        template.find(".ch_name").html(group.name);
        template.find('.group_fav_icon').css("display", 'none');
        template.addClass(group.fav ? 'is_fav' : '');
        template.find(".ch_fav").val(group.fav);

        // Display inline tags
        const tags = getTagsList(group.id);
        const tagsElement = template.find('.tags');
        tags.forEach(tag => appendTagToList(tagsElement, tag, {}));

        $("#rm_print_characters_block").prepend(template);
        updateGroupAvatar(group);
    }
}
function updateGroupAvatar(group) {
    $("#rm_print_characters_block .group_select").each(function () {
        if ($(this).data("id") == group.id) {
            const avatar = getGroupAvatar(group);
            if (avatar) {
                $(this).find(".avatar").replaceWith(avatar);
            }
        }
    });
}

function getGroupAvatar(group) {
    const memberAvatars = [];
    if (group && Array.isArray(group.members) && group.members.length) {
        for (const member of group.members) {
            const charIndex = characters.findIndex(x => x.avatar === member);
            if (charIndex !== -1 && characters[charIndex].avatar !== "none") {
                const avatar = getThumbnailUrl('avatar', characters[charIndex].avatar);
                memberAvatars.push(avatar);
            }
            if (memberAvatars.length === 4) {
                break;
            }
        }
    }

    // Cohee: there's probably a smarter way to do this..
    if (memberAvatars.length === 1) {
        const groupAvatar = $("#group_avatars_template .collage_1").clone();
        groupAvatar.find(".img_1").attr("src", memberAvatars[0]);
        return groupAvatar;
    }

    if (memberAvatars.length === 2) {
        const groupAvatar = $("#group_avatars_template .collage_2").clone();
        groupAvatar.find(".img_1").attr("src", memberAvatars[0]);
        groupAvatar.find(".img_2").attr("src", memberAvatars[1]);
        return groupAvatar;
    }

    if (memberAvatars.length === 3) {
        const groupAvatar = $("#group_avatars_template .collage_3").clone();
        groupAvatar.find(".img_1").attr("src", memberAvatars[0]);
        groupAvatar.find(".img_2").attr("src", memberAvatars[1]);
        groupAvatar.find(".img_3").attr("src", memberAvatars[2]);
        return groupAvatar;
    }

    if (memberAvatars.length === 4) {
        const groupAvatar = $("#group_avatars_template .collage_4").clone();
        groupAvatar.find(".img_1").attr("src", memberAvatars[0]);
        groupAvatar.find(".img_2").attr("src", memberAvatars[1]);
        groupAvatar.find(".img_3").attr("src", memberAvatars[2]);
        groupAvatar.find(".img_4").attr("src", memberAvatars[3]);
        return groupAvatar;
    }

    // default avatar
    const groupAvatar = $("#group_avatars_template .collage_1").clone();
    groupAvatar.find(".img_1").attr("src", group.avatar_url);
    return groupAvatar;
}


async function generateGroupWrapper(by_auto_mode, type = null, params = {}) {
    if (online_status === "no_connection") {
        is_group_generating = false;
        setSendButtonState(false);
        return;
    }

    // Auto-navigate back to group menu
    if (menu_type !== "group_edit") {
        select_group_chats(selected_group);
        await delay(1);
    }

    if (is_group_generating) {
        return false;
    }

    const group = groups.find((x) => x.id === selected_group);

    if (!group || !Array.isArray(group.members) || !group.members.length) {
        sendSystemMessage(system_message_types.EMPTY);
        return;
    }

    try {
        hideSwipeButtons();
        is_group_generating = true;
        setCharacterName('');
        setCharacterId(undefined);
        const userInput = $("#send_textarea").val();

        let typingIndicator = $("#chat .typing_indicator");

        if (typingIndicator.length === 0 && !isStreamingEnabled()) {
            typingIndicator = $(
                "#typing_indicator_template .typing_indicator"
            ).clone();
            typingIndicator.hide();
            $("#chat").append(typingIndicator);
        }

        // id of this specific batch for regeneration purposes
        group_generation_id = Date.now();
        const lastMessage = chat[chat.length - 1];
        let messagesBefore = chat.length;
        let lastMessageText = lastMessage.mes;
        let activationText = "";
        let isUserInput = false;
        let isGenerationDone = false;

        if (userInput && userInput.length && !by_auto_mode) {
            isUserInput = true;
            activationText = userInput;
            messagesBefore++;
        } else {
            if (lastMessage && !lastMessage.is_system) {
                activationText = lastMessage.mes;
            }
        }

        const resolveOriginal = params.resolve;
        const rejectOriginal = params.reject;

        if (typeof params.resolve === 'function') {
            params.resolve = function () {
                isGenerationDone = true;
                resolveOriginal.apply(this, arguments);
            };
        }

        if (typeof params.reject === 'function') {
            params.reject = function () {
                isGenerationDone = true;
                rejectOriginal.apply(this, arguments);
            }
        }

        const activationStrategy = Number(group.activation_strategy ?? group_activation_strategy.NATURAL);
        let activatedMembers = [];

        if (params && typeof params.force_chid == 'number') {
            activatedMembers = [params.force_chid];
        } else if (type === "quiet") {
            activatedMembers = activateSwipe(group.members);

            if (activatedMembers.length === 0) {
                activatedMembers = activateListOrder(group.members.slice(0, 1));
            }

        }
        else if (type === "swipe") {
            activatedMembers = activateSwipe(group.members);

            if (activatedMembers.length === 0) {
                callPopup('<h3>Deleted group member swiped. To get a reply, add them back to the group.</h3>', 'text');
                throw new Error('Deleted group member swiped');
            }
        }
        else if (type === "impersonate") {
            $("#send_textarea").attr("disabled", true);
            activatedMembers = activateImpersonate(group.members);
        }
        else if (activationStrategy === group_activation_strategy.NATURAL) {
            activatedMembers = activateNaturalOrder(group.members, activationText, lastMessage, group.allow_self_responses, isUserInput);
        }
        else if (activationStrategy === group_activation_strategy.LIST) {
            activatedMembers = activateListOrder(group.members);
        }

        // now the real generation begins: cycle through every character
        for (const chId of activatedMembers) {
            isGenerationDone = false;
            const generateType = type == "swipe" || type == "impersonate" || type == "quiet" ? type : "group_chat";
            setCharacterId(chId);
            setCharacterName(characters[chId].name)

            await Generate(generateType, { automatic_trigger: by_auto_mode, ...(params || {}) });

            if (type !== "swipe" && type !== "impersonate" && !isMultigenEnabled()) {
                // update indicator and scroll down
                typingIndicator
                    .find(".typing_indicator_name")
                    .text(characters[chId].name);
                $("#chat").append(typingIndicator);
                typingIndicator.show(250, function () {
                    typingIndicator.get(0).scrollIntoView({ behavior: "smooth" });
                });
            }

            // TODO: This is awful. Refactor this
            while (true) {
                // if not swipe - check if message generated already
                if (type !== "swipe" && !isMultigenEnabled() && chat.length == messagesBefore) {
                    await delay(100);
                }
                // if swipe - see if message changed
                else if (type === "swipe") {
                    if (isStreamingEnabled()) {
                        if (streamingProcessor && !streamingProcessor.isFinished) {
                            await delay(100);
                        }
                        else {
                            break;
                        }
                    }
                    else if (isMultigenEnabled()) {
                        if (isGenerationDone) {
                            break;
                        } else {
                            await delay(100);
                        }
                    }
                    else {
                        if (lastMessageText === chat[chat.length - 1].mes) {
                            await delay(100);
                        }
                        else {
                            break;
                        }
                    }
                }
                else if (type === "impersonate") {
                    if (isStreamingEnabled()) {
                        if (streamingProcessor && !streamingProcessor.isFinished) {
                            await delay(100);
                        }
                        else {
                            break;
                        }
                    }
                    else if (isMultigenEnabled()) {
                        if (isGenerationDone) {
                            break;
                        } else {
                            await delay(100);
                        }
                    }
                    else {
                        if (!$("#send_textarea").val() || $("#send_textarea").val() == userInput) {
                            await delay(100);
                        }
                        else {
                            break;
                        }
                    }
                }
                else if (type === 'quiet') {
                    if (isGenerationDone) {
                        break;
                    } else {
                        await delay(100);
                    }
                }
                else if (isMultigenEnabled()) {
                    if (isGenerationDone) {
                        messagesBefore++;
                        break;
                    } else {
                        await delay(100);
                    }
                }
                else {
                    messagesBefore++;
                    break;
                }
            }

            // hide and reapply the indicator to the bottom of the list
            typingIndicator.hide(250);
            $("#chat").append(typingIndicator);
        }
    } finally {
        is_group_generating = false;
        $("#send_textarea").attr("disabled", false);
        setSendButtonState(false);
        setCharacterId(undefined);
        setCharacterName('');
        showSwipeButtons();
    }
}

function getLastMessageGenerationId() {
    let generationId = null;
    if (chat.length > 0) {
        const lastMes = chat[chat.length - 1];
        if (!lastMes.is_user && !lastMes.is_system && lastMes.extra) {
            generationId = lastMes.extra.gen_id;
        }
    }
    return generationId;
}

function activateImpersonate(members) {
    const randomIndex = Math.floor(Math.random() * members.length);
    const activatedMembers = [members[randomIndex]];
    const memberIds = activatedMembers
        .map((x) => characters.findIndex((y) => y.avatar === x))
        .filter((x) => x !== -1);
    return memberIds;
}

function activateSwipe(members) {
    let activatedNames = [];

    // pre-update group chat swipe
    if (!chat[chat.length - 1].original_avatar) {
        const matches = characters.filter(x => x.name == chat[chat.length - 1].name);

        for (const match of matches) {
            if (members.includes(match.avatar)) {
                activatedNames.push(match.avatar);
                break;
            }
        }
    }
    else {
        activatedNames.push(chat[chat.length - 1].original_avatar);
    }

    const memberIds = activatedNames
        .map((x) => characters.findIndex((y) => y.avatar === x))
        .filter((x) => x !== -1);
    return memberIds;
}

function activateListOrder(members) {
    let activatedMembers = members.filter(onlyUnique);

    // map to character ids
    const memberIds = activatedMembers
        .map((x) => characters.findIndex((y) => y.avatar === x))
        .filter((x) => x !== -1);
    return memberIds;
}

function activateNaturalOrder(members, input, lastMessage, allowSelfResponses, isUserInput) {
    let activatedMembers = [];

    // prevents the same character from speaking twice
    let bannedUser = !isUserInput && lastMessage && !lastMessage.is_user && lastMessage.name;

    // ...unless allowed to do so
    if (allowSelfResponses) {
        bannedUser = undefined;
    }

    // find mentions (excluding self)
    if (input && input.length) {
        for (let inputWord of extractAllWords(input)) {
            for (let member of members) {
                const character = characters.find(x => x.avatar === member)

                if (!character || character.name === bannedUser) {
                    continue;
                }

                if (extractAllWords(character.name).includes(inputWord)) {
                    activatedMembers.push(member);
                    break;
                }
            }
        }
    }

    // activation by talkativeness (in shuffled order, except banned)
    const shuffledMembers = shuffle([...members]);
    for (let member of shuffledMembers) {
        const character = characters.find((x) => x.avatar === member);

        if (!character || character.name === bannedUser) {
            continue;
        }

        const rollValue = Math.random();
        let talkativeness = Number(character.talkativeness);
        talkativeness = Number.isNaN(talkativeness)
            ? talkativeness_default
            : talkativeness;
        if (talkativeness >= rollValue) {
            activatedMembers.push(member);
        }
    }

    // pick 1 at random if no one was activated
    while (activatedMembers.length === 0) {
        const randomIndex = Math.floor(Math.random() * members.length);
        const character = characters.find((x) => x.avatar === members[randomIndex]);

        if (!character) {
            continue;
        }

        activatedMembers.push(members[randomIndex]);
    }

    // de-duplicate array of character avatars
    activatedMembers = activatedMembers.filter(onlyUnique);

    // map to character ids
    const memberIds = activatedMembers
        .map((x) => characters.findIndex((y) => y.avatar === x))
        .filter((x) => x !== -1);
    return memberIds;
}

function extractAllWords(value) {
    const words = [];

    if (!value) {
        return words;
    }

    const matches = value.matchAll(/\b\w+\b/gim);
    for (let match of matches) {
        words.push(match[0].toLowerCase());
    }
    return words;
}


async function deleteGroup(id) {
    const response = await fetch("/deletegroup", {
        method: "POST",
        headers: getRequestHeaders(),
        body: JSON.stringify({ id: id }),
    });

    if (response.ok) {
        selected_group = null;
        resetChatState();
        clearChat();
        printMessages();
        await getCharacters();

        $("#rm_info_avatar").html("");
        $("#rm_info_block").transition({ opacity: 0, duration: 0 });
        select_rm_info("组已被删除!");
        $("#rm_info_block").transition({ opacity: 1.0, duration: 2000 });

        $("#rm_button_selected_ch").children("h2").text('');
        setRightTabSelectedClass();
    }
}

export async function editGroup(id, immediately, reload = true) {
    let group = groups.find((x) => x.id === id);

    if (!group) {
        return;
    }

    group['chat_metadata'] = chat_metadata;

    if (immediately) {
        return await _save(group, reload);
    }

    saveGroupDebounced(group);
}

async function groupChatAutoModeWorker() {
    if (!is_group_automode_enabled || online_status === "no_connection") {
        return;
    }

    if (!selected_group || is_send_press || is_group_generating) {
        return;
    }

    const group = groups.find((x) => x.id === selected_group);

    if (!group || !Array.isArray(group.members) || !group.members.length) {
        return;
    }

    await generateGroupWrapper(true);
}

async function modifyGroupMember(chat_id, groupMember, isDelete) {
    const id = groupMember.data("id");

    const template = groupMember.clone();
    let _thisGroup = groups.find((x) => x.id == chat_id);
    template.data("id", id);

    if (isDelete) {
        $("#rm_group_add_members").prepend(template);
    } else {
        $("#rm_group_members").prepend(template);
    }

    if (_thisGroup) {
        if (isDelete) {
            const index = _thisGroup.members.findIndex((x) => x === id);
            if (index !== -1) {
                _thisGroup.members.splice(index, 1);
            }
        } else {
            _thisGroup.members.push(id);
            template.css({ 'order': _thisGroup.members.length });
        }
        await editGroup(selected_group);
        updateGroupAvatar(_thisGroup);
    }
    else {
        template.css({ 'order': 'unset' });
    }

    groupMember.remove();
    const groupHasMembers = !!$("#rm_group_members").children().length;
    $("#rm_group_submit").prop("disabled", !groupHasMembers);
}

async function reorderGroupMember(chat_id, groupMember, direction) {
    const id = groupMember.data("id");
    const group = groups.find((x) => x.id == chat_id);

    // Existing groups need to modify members list
    if (group && group.members.length > 1) {
        const indexOf = group.members.indexOf(id);
        if (direction == 'down') {
            const next = group.members[indexOf + 1];
            if (next) {
                group.members[indexOf + 1] = group.members[indexOf];
                group.members[indexOf] = next;
            }
        }
        if (direction == 'up') {
            const prev = group.members[indexOf - 1];
            if (prev) {
                group.members[indexOf - 1] = group.members[indexOf];
                group.members[indexOf] = prev;
            }
        }

        await editGroup(chat_id);
        updateGroupAvatar(group);
        // stupid but lifts the manual reordering
        select_group_chats(chat_id, true);
    }
    // New groups just can't be DOM-ordered
    else {
        if (direction == 'down') {
            groupMember.insertAfter(groupMember.next());
        }
        if (direction == 'up') {
            groupMember.insertBefore(groupMember.prev());
        }
    }
}

function select_group_chats(groupId, skipAnimation) {
    const group = groupId && groups.find((x) => x.id == groupId);
    const groupName = group?.name ?? "";
    setMenuType(!!group ? 'group_edit' : 'group_create');
    $("#rm_group_chat_name").val(groupName);
    $("#rm_group_chat_name").off();
    $("#rm_group_chat_name").on("input", async function () {
        if (groupId) {
            let _thisGroup = groups.find((x) => x.id == groupId);
            _thisGroup.name = $(this).val();
            $("#rm_button_selected_ch").children("h2").text(_thisGroup.name);
            await editGroup(groupId);
        }
    });
    $("#rm_group_filter").val("").trigger("input");

    $('input[name="rm_group_activation_strategy"]').off();
    $('input[name="rm_group_activation_strategy"]').on("input", async function (e) {
        if (groupId) {
            let _thisGroup = groups.find((x) => x.id == groupId);
            _thisGroup.activation_strategy = Number(e.target.value);
            await editGroup(groupId);
        }
    });
    const replyStrategy = Number(group?.activation_strategy ?? group_activation_strategy.NATURAL);
    $(`input[name="rm_group_activation_strategy"][value="${replyStrategy}"]`).prop('checked', true);

    if (!skipAnimation) {
        selectRightMenuWithAnimation('rm_group_chats_block');
    }

    // render characters list
    $("#rm_group_add_members").empty();
    $("#rm_group_members").empty();
    for (let character of characters) {
        const avatar =
            character.avatar != "none"
                ? getThumbnailUrl('avatar', character.avatar)
                : default_avatar;
        const template = $("#group_member_template .group_member").clone();
        template.data("id", character.avatar);
        template.find(".avatar img").attr("src", avatar);
        template.find(".avatar img").attr("title", character.avatar);
        template.find(".ch_name").text(character.name);
        template.attr("chid", characters.indexOf(character));
        template.addClass(character.fav == 'true' ? 'is_fav' : '');

        if (!group) {
            template.find('[data-action="speak"]').hide();
        }

        if (
            group &&
            Array.isArray(group.members) &&
            group.members.includes(character.avatar)
        ) {
            template.css({ 'order': group.members.indexOf(character.avatar) });
            $("#rm_group_members").append(template);
        } else {
            $("#rm_group_add_members").append(template);
        }
    }

    sortGroupMembers("#rm_group_add_members .group_member");
    filterMembersByFavorites(false);

    const groupHasMembers = !!$("#rm_group_members").children().length;
    $("#rm_group_submit").prop("disabled", !groupHasMembers);
    $("#rm_group_allow_self_responses").prop("checked", group && group.allow_self_responses);

    // bottom buttons
    if (groupId) {
        $("#rm_group_submit").hide();
        $("#rm_group_delete").show();
        $("#rm_group_scenario").show();
    } else {
        $("#rm_group_submit").show();
        $("#rm_group_delete").hide();
        $("#rm_group_scenario").hide();
    }

    $("#rm_group_delete").off();
    $("#rm_group_delete").on("click", function () {
        if (is_group_generating) {
            callPopup('<h3>你太快了! 等成员打完字再删除组。</h3>', 'text');
            return;
        }

        $("#dialogue_popup").data("group_id", groupId);
        callPopup("<h3>删除组?</h3>", "del_group");
    });

    updateFavButtonState(group?.fav ?? false);

    $("#group_favorite_button").off('click');
    $("#group_favorite_button").on('click', async function () {
        updateFavButtonState(!fav_grp_checked);
        if (group) {
            let _thisGroup = groups.find((x) => x.id == groupId);
            _thisGroup.fav = fav_grp_checked;
            await editGroup(groupId);
        }
    });

    $("#rm_group_allow_self_responses").off();
    $("#rm_group_allow_self_responses").on("input", async function () {
        if (group) {
            let _thisGroup = groups.find((x) => x.id == groupId);
            const value = $(this).prop("checked");
            _thisGroup.allow_self_responses = value;
            await editGroup(groupId);
        }
    });

    // top bar
    if (group) {
        $("#rm_group_automode_label").show();
        $("#rm_button_selected_ch").children("h2").text(groupName);
        setRightTabSelectedClass('rm_button_selected_ch');
    }
    else {
        $("#rm_group_automode_label").hide();
    }

    $(document).off("click", ".group_member .right_menu_button");
    $(document).on("click", ".group_member .right_menu_button", async function (event) {
        event.stopPropagation();
        const action = $(this).data('action');
        const member = $(this).closest('.group_member');

        if (action === 'remove') {
            await modifyGroupMember(groupId, member, true);
        }

        if (action === 'add') {
            await modifyGroupMember(groupId, member, false);
        }

        if (action === 'up' || action === 'down') {
            await reorderGroupMember(groupId, member, action);
        }

        if (action === 'view') {
            openCharacterDefinition(member);
        }

        if (action === 'speak') {
            const chid = Number(member.attr('chid'));
            if (Number.isInteger(chid)) {
                Generate('normal', { force_chid: chid });
            }
        }

        sortGroupMembers("#rm_group_add_members .group_member");
    });
}

function updateFavButtonState(state) {
    fav_grp_checked = state;
    $("#rm_group_fav").val(fav_grp_checked);
    $("#group_favorite_button").toggleClass('fav_on', fav_grp_checked);
    $("#group_favorite_button").toggleClass('fav_off', !fav_grp_checked);
}

async function selectGroup() {
    const groupId = $(this).data("id");

    if (!is_send_press && !is_group_generating) {
        if (selected_group !== groupId) {
            cancelTtsPlay();
            selected_group = groupId;
            setCharacterId(undefined);
            setCharacterName('');
            setEditedMessageId(undefined);
            clearChat();
            updateChatMetadata({}, true);
            chat.length = 0;
            await getGroupChat(groupId);
        }

        select_group_chats(groupId);
    }
}

function openCharacterDefinition(characterSelect) {
    if (is_group_generating) {
        console.warn("Can't peek a character def while group reply is being generated");
        return;
    }

    const chid = characterSelect.attr('chid');

    if (chid === null || chid === undefined) {
        return;
    }

    setCharacterId(chid);
    select_selected_character(chid);
    // Gentle nudge to recalculate tokens
    RA_CountCharTokens();
    // Do a little tomfoolery to spoof the tag selector
    applyTagsOnCharacterSelect.call(characterSelect);
}

function filterGroupMembers() {
    const searchValue = $(this).val().trim().toLowerCase();

    if (!searchValue) {
        $("#rm_group_add_members .group_member").removeClass('hiddenBySearch');
    } else {
        $("#rm_group_add_members .group_member").each(function () {
            const isValidSearch = $(this).children(".ch_name").text().toLowerCase().includes(searchValue);
            $(this).toggleClass('hiddenBySearch', !isValidSearch);
        });
    }
}

async function createGroup() {
    let name = $("#rm_group_chat_name").val();
    let allow_self_responses = !!$("#rm_group_allow_self_responses").prop("checked");
    let activation_strategy = $('input[name="rm_group_activation_strategy"]:checked').val() ?? group_activation_strategy.NATURAL;
    const members = $("#rm_group_members .group_member")
        .map((_, x) => $(x).data("id"))
        .toArray();

    const memberNames = characters.filter(x => members.includes(x.avatar)).map(x => x.name).join(", ");

    if (!name) {
        name = `Group: ${memberNames}`;
    }

    // placeholder
    const avatar_url = 'img/five.png';

    const chatName = humanizedDateTime();
    const chats = [chatName];

    const createGroupResponse = await fetch("/creategroup", {
        method: "POST",
        headers: getRequestHeaders(),
        body: JSON.stringify({
            name: name,
            members: members,
            avatar_url: avatar_url,
            allow_self_responses: allow_self_responses,
            activation_strategy: activation_strategy,
            chat_metadata: {},
            fav: fav_grp_checked,
            chat_id: chatName,
            chats: chats,
        }),
    });

    if (createGroupResponse.ok) {
        const data = await createGroupResponse.json();
        createTagMapFromList("#groupTagList", data.id);

        await getCharacters();
        $("#rm_info_avatar").html("");
        const avatar = $("#avatar_div_div").clone();
        avatar.find("img").attr("src", avatar_url);
        $("#rm_info_avatar").append(avatar);
        $("#rm_info_block").transition({ opacity: 0, duration: 0 });
        select_rm_info("Group chat created");
        $("#rm_info_block").transition({ opacity: 1.0, duration: 2000 });
    }
}

function toggleFilterByFavorites() {
    filterMembersByFavorites(!fav_filter_on);
}

function filterMembersByFavorites(value) {
    fav_filter_on = value;
    $('#group_fav_filter').toggleClass('fav_on', fav_filter_on);

    if (!fav_filter_on) {
        $("#rm_group_add_members .group_member").removeClass('hiddenByFav');
    } else {
        $("#rm_group_add_members .group_member").each(function () {
            const isValidSearch = $(this).hasClass("is_fav");
            $(this).toggleClass('hiddenByFav', !isValidSearch);
        });
    }
}

export async function createNewGroupChat(groupId) {
    const group = groups.find(x => x.id === groupId);

    if (!group) {
        return;
    }

    const oldChatName = group.chat_id;
    const newChatName = humanizedDateTime();

    if (typeof group.past_metadata !== 'object') {
        group.past_metadata = {};
    }

    clearChat();
    chat.length = 0;
    if (oldChatName) {
        group.past_metadata[oldChatName] = Object.assign({}, chat_metadata);
    }
    group.chats.push(newChatName);
    group.chat_id = newChatName;
    group.chat_metadata = {};
    updateChatMetadata(group.chat_metadata, true);

    await editGroup(group.id, true);
    await getGroupChat(group.id);
}

export async function getGroupPastChats(groupId) {
    const group = groups.find(x => x.id === groupId);

    if (!group) {
        return [];
    }

    const chats = [];

    try {
        for (const chatId of group.chats) {
            const messages = await loadGroupChat(chatId);
            let this_chat_file_size = (JSON.stringify(messages).length / 1024).toFixed(2) + "kb";
            let chat_items = messages.length;
            const lastMessage = messages.length ? messages[messages.length - 1].mes : '[The chat is empty]';
            chats.push({
                'file_name': chatId,
                'mes': lastMessage,
                'file_size': this_chat_file_size,
                'chat_items': chat_items,
            });
        }
    } catch (err) {
        console.error(err);
    }
    finally {
        return chats;
    }
}

export async function openGroupChat(groupId, chatId) {
    const group = groups.find(x => x.id === groupId);

    if (!group || !group.chats.includes(chatId)) {
        return;
    }

    clearChat();
    chat.length = 0;
    const previousChat = group.chat_id;
    group.past_metadata[previousChat] = Object.assign({}, chat_metadata);
    group.chat_id = chatId;
    group.chat_metadata = group.past_metadata[chatId] || {};
    group['date_last_chat'] = Date.now();
    updateChatMetadata(group.chat_metadata, true);

    await editGroup(groupId, true);
    await getGroupChat(groupId);
    sortCharactersList();
}

export async function renameGroupChat(groupId, oldChatId, newChatId) {
    const group = groups.find(x => x.id === groupId);

    if (!group || !group.chats.includes(oldChatId)) {
        return;
    }

    if (group.chat_id === oldChatId) {
        group.chat_id = newChatId;
    }

    group.chats.splice(group.chats.indexOf(oldChatId), 1);
    group.chats.push(newChatId);
    group.past_metadata[newChatId] = (group.past_metadata[oldChatId] || {});
    delete group.past_metadata[oldChatId];

    await editGroup(groupId, true, true);
}

export async function deleteGroupChat(groupId, chatId) {
    const group = groups.find(x => x.id === groupId);

    if (!group || !group.chats.includes(chatId)) {
        return;
    }

    group.chats.splice(group.chats.indexOf(chatId), 1);
    group.chat_metadata = {};
    group.chat_id = '';
    delete group.past_metadata[chatId];
    updateChatMetadata(group.chat_metadata, true);

    const response = await fetch('/deletegroupchat', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ id: chatId }),
    });

    if (response.ok) {
        if (group.chats.length) {
            await openGroupChat(groupId, group.chats[0]);
        } else {
            await createNewGroupChat(groupId);
        }
    }
}

export async function saveGroupBookmarkChat(groupId, name, metadata) {
    const group = groups.find(x => x.id === groupId);

    if (!group) {
        return;
    }

    group.past_metadata[name] = { ...chat_metadata, ...(metadata || {}) };
    group.chats.push(name);

    await editGroup(groupId, true);

    await fetch("/savegroupchat", {
        method: "POST",
        headers: getRequestHeaders(),
        body: JSON.stringify({ id: name, chat: [...chat] }),
    });
}

function setGroupScenario() {
    if (!selected_group) {
        return;
    }

    const template = $('#group_scenario_template .group_scenario').clone();
    const metadataValue = chat_metadata['scenario'] || '';
    template.find('.group_chat_scenario').text(metadataValue);
    callPopup(template.get(0).outerHTML, 'text');
}

function onGroupScenarioInput() {
    const value = $(this).val();
    const metadata = { scenario: value, };
    updateChatMetadata(metadata, false);
}

function onGroupScenarioRemoveClick() {
    $(this).closest('.group_scenario').find('.group_chat_scenario').val('').trigger('input');
}

jQuery(() => {
    $(document).on("click", ".group_select", selectGroup);
    $(document).on("input", ".group_chat_scenario", onGroupScenarioInput);
    $(document).on("click", ".remove_scenario_override", onGroupScenarioRemoveClick);
    $("#rm_group_filter").on("input", filterGroupMembers);
    $("#group_fav_filter").on("click", toggleFilterByFavorites);
    $("#rm_group_submit").on("click", createGroup);
    $("#rm_group_scenario").on("click", setGroupScenario);
    $("#rm_group_automode").on("input", function () {
        const value = $(this).prop("checked");
        is_group_automode_enabled = value;
    });
});