'use strict';

// Apply a narrow, version-checked fix for LID-migrated status reactions in gifted-baileys 2.5.8.
// This patches only the installed library file. It does not touch WhatsApp auth/session data.

const fs = require('node:fs');
const path = require('node:path');

function findPackageRoot(entry) {
    let directory = path.dirname(entry);
    while (directory && directory !== path.dirname(directory)) {
        const packageFile = path.join(directory, 'package.json');
        if (fs.existsSync(packageFile)) {
            try {
                const metadata = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
                if (metadata.name === 'gifted-baileys') return { directory, metadata };
            } catch {
                // Continue walking up if this is not a readable package manifest.
            }
        }
        directory = path.dirname(directory);
    }
    return null;
}

function main() {
    let entry;
    try {
        entry = require.resolve('@whiskeysockets/baileys');
    } catch {
        console.error('Could not resolve @whiskeysockets/baileys. No files were changed.');
        process.exitCode = 1;
        return;
    }

    const found = findPackageRoot(entry);
    if (!found) {
        console.error('Could not identify the installed gifted-baileys package. No files were changed.');
        process.exitCode = 1;
        return;
    }

    if (found.metadata.version !== '2.5.8') {
        console.error('This patch is validated for gifted-baileys 2.5.8; found ' +
            String(found.metadata.version || 'unknown') + '. No files were changed.');
        process.exitCode = 1;
        return;
    }

    const sourceFile = path.join(found.directory, 'lib', 'Socket', 'messages-send.js');
    const mappingFile = path.join(found.directory, 'lib', 'Utils', 'lid-mapping.js');
    if (!fs.existsSync(sourceFile) || !fs.existsSync(mappingFile)) {
        console.error('Expected gifted-baileys source files were not found. No files were changed.');
        process.exitCode = 1;
        return;
    }

    let source = fs.readFileSync(sourceFile, 'utf8');
    if (source.includes('MUSHII_STATUS_LID_ONLY_RECIPIENTS')) {
        console.log('MUSHII status LID patch is already installed.');
        return;
    }

    const importLine = 'const lid_mapping_1 = require("../Utils/lid-mapping");';
    if (!source.includes(importLine)) {
        const importAnchor = 'const newsletter_1 = require("./newsletter");';
        if (!source.includes(importAnchor)) {
            console.error('Could not find the expected import section. No files were changed.');
            process.exitCode = 1;
            return;
        }
        source = source.replace(importAnchor, importAnchor + '\n' + importLine);
    }

    const oldBlock = [
        '                    if (isStatus) {',
        '                        // Always include sender\'s own JID for status so they can see their own status',
        '                        const normalizedMeId = (0, WABinary_1.jidNormalizedUser)(meId);',
        '                        if (!participantsList.includes(normalizedMeId)) {',
        '                            participantsList.push(normalizedMeId);',
        '                        }',
        '                        // Also include sender\'s LID if available for multi-device compatibility',
        '                        const meLid = authState.creds.me?.lid;',
        '                        if (meLid) {',
        '                            const normalizedMeLid = (0, WABinary_1.jidNormalizedUser)(meLid);',
        '                            if (!participantsList.includes(normalizedMeLid)) {',
        '                                participantsList.push(normalizedMeLid);',
        '                            }',
        '                        }',
        '                        // Add statusJidList recipients if provided',
        '                        if (statusJidList && Array.isArray(statusJidList) && statusJidList.length > 0) {',
        '                            for (const jidItem of statusJidList) {',
        '                                const normalizedJid = (0, WABinary_1.jidNormalizedUser)(jidItem);',
        '                                if (!participantsList.includes(normalizedJid)) {',
        '                                    participantsList.push(normalizedJid);',
        '                                }',
        '                            }',
        '                        } else {',
        '                            logger.warn({ meId }, \'No statusJidList provided for status message - only sender will see the status. Provide statusJidList with contact JIDs for others to view.\');',
        '                        }',
        '                        logger.debug({ participantsList, statusJidList }, \'Status message participants\');',
        '                    }'
    ].join('\n');

    const newBlock = [
        '                    if (isStatus) {',
        '                        // MUSHII_STATUS_LID_ONLY_RECIPIENTS:',
        '                        // LID-migrated accounts must not mix the sender PN with LID recipients.',
        '                        // Resolve status recipient phone JIDs to LIDs before device enumeration.',
        '                        const meLid = authState.creds.me?.lid;',
        '                        if (meLid) {',
        '                            const normalizedMeLid = (0, WABinary_1.jidNormalizedUser)(meLid);',
        '                            if (!participantsList.includes(normalizedMeLid)) {',
        '                                participantsList.push(normalizedMeLid);',
        '                            }',
        '                        } else {',
        '                            const normalizedMeId = (0, WABinary_1.jidNormalizedUser)(meId);',
        '                            if (!participantsList.includes(normalizedMeId)) {',
        '                                participantsList.push(normalizedMeId);',
        '                            }',
        '                        }',
        '',
        '                        if (statusJidList && Array.isArray(statusJidList) && statusJidList.length > 0) {',
        '                            for (const jidItem of statusJidList) {',
        '                                let normalizedJid = (0, WABinary_1.jidNormalizedUser)(jidItem);',
        '                                if (meLid && normalizedJid.endsWith(\'@s.whatsapp.net\')) {',
        '                                    const mappedLid = lid_mapping_1.globalLidMapping.getLidFromPn(normalizedJid);',
        '                                    if (!mappedLid) {',
        '                                        throw new boom_1.Boom(\'Could not resolve LID for one status recipient. Refresh contacts and retry.\', { statusCode: 400 });',
        '                                    }',
        '                                    normalizedJid = (0, WABinary_1.jidNormalizedUser)(mappedLid);',
        '                                }',
        '                                if (meLid && !normalizedJid.endsWith(\'@lid\') && !normalizedJid.endsWith(\'@hosted.lid\')) {',
        '                                    throw new boom_1.Boom(\'A LID-migrated account requires LID-addressed status recipients.\', { statusCode: 400 });',
        '                                }',
        '                                if (!participantsList.includes(normalizedJid)) {',
        '                                    participantsList.push(normalizedJid);',
        '                                }',
        '                            }',
        '                        } else {',
        '                            logger.warn({ meId }, \'No statusJidList provided for status message - only sender will see the status. Provide statusJidList with contact JIDs for others to view.\');',
        '                        }',
        '                        logger.debug({ participantsList, statusJidList }, \'Status message participants\');',
        '                    }'
    ].join('\n');

    if (!source.includes(oldBlock)) {
        console.error('The installed gifted-baileys source does not match the expected 2.5.8 status block. No library file was changed.');
        process.exitCode = 1;
        return;
    }

    source = source.replace(oldBlock, newBlock);

    const backupFile = sourceFile + '.mushii-original.bak';
    if (!fs.existsSync(backupFile)) {
        fs.copyFileSync(sourceFile, backupFile, fs.constants.COPYFILE_EXCL);
    }

    const tempFile = sourceFile + '.mushii.tmp';
    fs.writeFileSync(tempFile, source, { mode: 0o600 });
    fs.renameSync(tempFile, sourceFile);

    console.log('Applied MUSHII LID-only status-recipient patch to gifted-baileys 2.5.8.');
    console.log('Original library file backed up beside the patched file.');
    console.log('Next: run node --check on the patched library file, then npm test.');
}

main();
