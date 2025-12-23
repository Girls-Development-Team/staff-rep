import { 
    Interaction, 
    GuildMember, 
    TextChannel, 
    EmbedBuilder, 
    ApplicationCommandOptionType, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle 
} from 'discord.js';
import { IEvent } from '../../core/IEvent';
import { CustomClient, UserData } from '../../types';
import { StaffLogic, staffConfig } from '../../utils/StaffLogic';

const COMMANDS_PER_PAGE = 5;

const handleButtons: IEvent<'interactionCreate'> = {
    name: 'interactionCreate',
    execute: async (interaction: Interaction, client: CustomClient) => {
        if (!interaction.isButton()) return;
        const { customId } = interaction;

        // --- 1. HELP PAGE LOGIC ---
        if (customId.startsWith('help_')) {
            // Acknowledge immediately to prevent 3-second timeout
            await interaction.deferUpdate();

            const [action, currentPageStr] = customId.split(':');
            let page = parseInt(currentPageStr);
            
            // Calculate new page target
            if (action === 'help_next') page++;
            if (action === 'help_prev') page--;

            const commandList: string[] = [];
            client.commands.forEach((cmd) => {
                const data = cmd.data as any;
                const cmdName = data.name;
                const cmdDesc = data.description;

                if (!data.options || data.options.length === 0) {
                    commandList.push(`**/${cmdName}**\n└ ${cmdDesc}`);
                } else {
                    let hasSubcommands = false;
                    data.options.forEach((opt: any) => {
                        if (opt.type === ApplicationCommandOptionType.Subcommand) {
                            hasSubcommands = true;
                            commandList.push(`**/${cmdName} ${opt.name}**\n└ ${opt.description}`);
                        } else if (opt.type === ApplicationCommandOptionType.SubcommandGroup) {
                            hasSubcommands = true;
                            opt.options?.forEach((subOpt: any) => {
                                commandList.push(`**/${cmdName} ${opt.name} ${subOpt.name}**\n└ ${subOpt.description}`);
                            });
                        }
                    });
                    if (!hasSubcommands) commandList.push(`**/${cmdName}**\n└ ${cmdDesc}`);
                }
            });

            const totalPages = Math.ceil(commandList.length / COMMANDS_PER_PAGE);
            
            // Boundary safety to prevent index out of bounds
            if (page < 0) page = 0;
            if (page >= totalPages) page = totalPages - 1;

            const embed = new EmbedBuilder()
                // FIXED: Shows total commands count dynamically in the title
                .setTitle(`📖 Available Commands (${commandList.length})`)
                .setDescription(commandList.slice(page * COMMANDS_PER_PAGE, (page + 1) * COMMANDS_PER_PAGE).join('\n\n'))
                .setFooter({ text: `Page ${page + 1} of ${totalPages} • Powered by ${client.user?.username}` })
                .setColor(0x5865F2);

            // UPDATED: The customId correctly carries the 'page' index the user has just moved TO.
            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId(`help_prev:${page}`)
                    .setLabel('Previous')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(page === 0),
                new ButtonBuilder()
                    .setCustomId(`help_next:${page}`)
                    .setLabel('Next')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(page >= totalPages - 1)
            );

            await interaction.editReply({ embeds: [embed], components: [row] });
            return; 
        }

        // --- 2. Authorization Check (Only for Staff Management Buttons) ---
        if (!StaffLogic.isAuthorized(interaction.member as GuildMember)) {
            await interaction.reply({ content: "❌ You are not authorized to manage staff requests.", ephemeral: true });
            return;
        }

        // --- 3. Defer (Ephemeral) for Staff Buttons ---
        await interaction.deferReply({ ephemeral: true });

        // --- PROMOTION / DEMOTION LOGIC ---
        if (customId.startsWith('BTN_APPROVE_REQ_')) {
            const [, , , targetId, type] = customId.split('_'); 
            const member = await interaction.guild?.members.fetch(targetId).catch(() => null);
            
            if (!member) {
                await interaction.editReply("❌ Member not found or has left the guild.");
                return;
            }

            const result = await StaffLogic.processRankChange(client, member, type as 'PROMO' | 'DEMO', interaction.user);
            
            if (interaction.message.deletable) await interaction.message.delete();
            await interaction.editReply(result);
            
            const logChannel = await client.channels.fetch(staffConfig.channels.log) as TextChannel;
            if (logChannel) logChannel.send(result);
        }
        
        else if (customId.startsWith('BTN_DENY_REQ_')) {
            if (interaction.message.deletable) await interaction.message.delete();
            await interaction.editReply("✅ Request denied. Points remain unchanged.");
        }

        // --- LOA LOGIC ---
        else if (customId.startsWith('BTN_LOA_APPROVE_')) {
            const targetId = customId.split('_')[3];
            const targetUser = await client.users.fetch(targetId).catch(() => null);
            
            let originalReason = "Approved by Management";
            if (interaction.message.embeds.length > 0) {
                const fields = interaction.message.embeds[0].fields;
                const reasonField = fields.find(f => f.name.includes('Reason'));
                if (reasonField) {
                    originalReason = reasonField.value.replace(/`/g, '');
                } else {
                    const desc = interaction.message.embeds[0].description || "";
                    const match = desc.match(/\*\*Reason:\*\* (.*)/);
                    if (match) originalReason = match[1];
                }
            }

            await client.database.updateUser(targetId, {
                loaStatus: { isActive: true, since: Date.now(), reason: originalReason }
            });

            await interaction.message.edit({ components: [] });

            const approvalEmbed = new EmbedBuilder()
                .setTitle('✅ Formal LOA Approval')
                .setColor(0x00FF00)
                .setThumbnail(targetUser?.displayAvatarURL() || null)
                .addFields(
                    { name: '👤 Staff Member', value: `<@${targetId}>`, inline: true },
                    { name: '🛡️ Authorized By', value: `<@${interaction.user.id}>`, inline: true },
                    { name: '📅 Effective Date', value: `<t:${Math.floor(Date.now() / 1000)}:f>`, inline: false },
                    { name: '📝 Reason Logged', value: `\`\`\`${originalReason}\`\`\``, inline: false }
                )
                .setFooter({ text: 'Status: Active • Staff Management System' })
                .setTimestamp();

            if (interaction.channel?.isSendable()) {
                 await interaction.message.reply({ embeds: [approvalEmbed] });
            }

            await interaction.editReply(`✅ You approved the LOA for <@${targetId}>.`);

            if (targetUser) {
                const dmEmbed = new EmbedBuilder()
                    .setTitle('✅ LOA Request Approved')
                    .setDescription(`Your Leave of Absence request has been approved by <@${interaction.user.id}>.`)
                    .addFields({ name: 'Reason Logged', value: originalReason })
                    .setColor(0x00FF00)
                    .setFooter({ text: 'Use /loa return when you are back!' });
                    
                await targetUser.send({ embeds: [dmEmbed] }).catch(() => {});
            }
        }

        else if (customId.startsWith('BTN_LOA_DENY_')) {
             const targetId = customId.split('_')[3];
             const targetUser = await client.users.fetch(targetId).catch(() => null);

             await interaction.message.edit({ components: [] });
             
             const denialEmbed = new EmbedBuilder()
                .setTitle('⛔ LOA Request Denied')
                .setColor(0xFF0000)
                .setThumbnail(targetUser?.displayAvatarURL() || null)
                .addFields(
                    { name: '👤 Staff Member', value: `<@${targetId}>`, inline: true },
                    { name: '🛡️ Denied By', value: `<@${interaction.user.id}>`, inline: true },
                    { name: '📅 Date', value: `<t:${Math.floor(Date.now() / 1000)}:f>`, inline: false }
                )
                .setFooter({ text: 'Status: Denied • Staff Management System' })
                .setTimestamp();

             if (interaction.channel?.isSendable()) {
                 await interaction.message.reply({ embeds: [denialEmbed] });
             }

             await interaction.editReply("✅ You denied the request.");
             if(targetUser) targetUser.send("❌ Your LOA request was **denied** by management.").catch(() => {});
        }

        else if (customId === 'BTN_MASS_PROCESS') {
            const allUsers = await client.database.getLeaderboard('positiveRep', 100);
            const eligible = allUsers.filter((u: UserData) => (u.positiveRep || 0) >= 10 || (u.negativeRep || 0) >= 10);
            
            let report = "Processing Report:\n";
            for (const u of eligible) {
                const member = await interaction.guild?.members.fetch(u.userId).catch(() => null);
                if (member) {
                    const type = (u.positiveRep || 0) >= 10 ? 'PROMO' : 'DEMO';
                    const res = await StaffLogic.processRankChange(client, member, type, interaction.user);
                    report += `${res}\n`;
                }
            }
            await interaction.editReply(report.substring(0, 2000));
        }
    }
};

export default handleButtons;