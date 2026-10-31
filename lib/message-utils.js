'use strict';

function unwrapMessageContent(content) {
    let current = content;

    // WhatsApp can stack disappearing, device-sent, and document wrappers.
    // View Once wrappers deliberately remain opaque to preserve sender privacy.
    for (let i = 0; i < 8 && current; i++) {
        const next = current.deviceSentMessage?.message
            || current.ephemeralMessage?.message
            || current.documentWithCaptionMessage?.message
            || current.editedMessage?.message?.protocolMessage?.editedMessage;

        if (!next || next === current) break;
        current = next;
    }

    return current || content;
}

function containsViewOnceWrapper(content) {
    let current = content;
    for (let i = 0; i < 8 && current; i++) {
        if (current.viewOnceMessageV2 || current.viewOnceMessageV2Extension || current.viewOnceMessage) return true;
        const next = current.deviceSentMessage?.message
            || current.ephemeralMessage?.message
            || current.documentWithCaptionMessage?.message
            || current.editedMessage?.message?.protocolMessage?.editedMessage;
        if (!next || next === current) break;
        current = next;
    }
    return false;
}

function extractMessageText(rawMessage, normalize = value => value) {
    if (!rawMessage) return '';

    const normalized = normalize(rawMessage) || rawMessage;
    const message = unwrapMessageContent(normalized) || normalized;

    return (
        message.conversation ||
        message.extendedTextMessage?.text ||
        message.imageMessage?.caption ||
        message.videoMessage?.caption ||
        message.audioMessage?.caption ||
        message.documentMessage?.caption ||
        message.buttonsMessage?.contentText ||
        message.buttonsResponseMessage?.selectedButtonId ||
        message.buttonsResponseMessage?.selectedDisplayText ||
        message.listMessage?.description ||
        message.listResponseMessage?.singleSelectReply?.selectedRowId ||
        message.listResponseMessage?.title ||
        message.templateMessage?.hydratedTemplate?.hydratedContentText ||
        message.templateButtonReplyMessage?.selectedDisplayText ||
        message.interactiveMessage?.body?.text ||
        message.interactiveResponseMessage?.body?.text ||
        message.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson ||
        message.highlyStructuredMessage?.hydratedHsm?.hydratedContentText ||
        message.highlyStructuredMessage?.hydratedHsm?.hydratedButtons?.[0]?.callToActionButton?.displayText ||
        message.productMessage?.contextInfo?.quotedMessage?.conversation ||
        message.orderMessage?.message ||
        message.reactionMessage?.text ||
        rawMessage.conversation ||
        rawMessage.extendedTextMessage?.text ||
        ''
    ).replace(/^\uFEFF/, '').replace(/^\u200B+/, '').trim();
}

module.exports = { unwrapMessageContent, extractMessageText, containsViewOnceWrapper };
