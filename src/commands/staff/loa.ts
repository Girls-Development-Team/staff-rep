import { ApplicationCommandOptionType, CommandInteraction, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, TextChannel, GuildMember } from 'discord.js';
import { IApplicationCommand } from '../../core/IApplicationCommand';
import { CustomClient } from '../../types';
import { staffConfig } from '../../utils/StaffLogic';

const loaCommand: IApplicationCommand = {
    data: {
        name: 'loa',
        description: 'Manage Leave of Absence.',
        options: [
            {
                name: 'request',
                description: 'Submit a formal request for Leave of Absence.',
                type: ApplicationCommandOptionType.Subcommand,
                options: [{ name: 'reason', description: 'The reason for your leave.', type: ApplicationCommandOptionType.String, required: true }]
            },
            {
                name: 'return',
                description: 'Mark yourself as returned to active duty.',
                type: ApplicationCommandOptionType.Subcommand
            }
        ]
    },
    permissions: 'user', 

    async execute(interaction: CommandInteraction, client: CustomClient) {
        if (!interaction.isChatInputCommand()) return;
        await interaction.deferReply({ ephemeral: true });

        const member = interaction.member as GuildMember;
        const staffRoleIds = staffConfig.roles.staffHierarchy.map((r: any) => r.id);
        
        if (!member.roles.cache.hasAny(...staffRoleIds)) {
            return interaction.editReply("⛔ **Access Denied:** This command is restricted to **Staff Members** only.");
        }

        const sub = interaction.options.getSubcommand();
        const userId = interaction.user.id;
        
        const userData = await client.database.getOrCreateUser(userId);

        if (sub === 'request') {
            if (userData.loaStatus?.isActive) {
                return interaction.editReply({ 
                    content: `❌ **Request Blocked:** You are already marked as being on **LOA** (since <t:${Math.floor((userData.loaStatus.since || 0)/1000)}:R>).\n\nIf you are back, please use \`/loa return\` first.` 
                });
            }

            const reason = interaction.options.getString('reason', true);
            const mgmtChannel = await client.channels.fetch(staffConfig.channels.management) as TextChannel;
            const mgmtRoleId = staffConfig.roles.manager;

            if (!mgmtChannel) {
                return interaction.editReply("❌ Configuration Error: Management channel not found.");
            }

            const embed = new EmbedBuilder()
                .setTitle('📄 Formal Leave of Absence Request')
                .setColor(0xFFA500) 
                .setThumbnail(interaction.user.displayAvatarURL())
                .addFields(
                    { name: '👤 Staff Member', value: `<@${userId}> (${interaction.user.tag})`, inline: true },
                    { name: '📅 Date Requested', value: `<t:${Math.floor(Date.now() / 1000)}:f>`, inline: true },
                    { name: '📝 Reason for Leave', value: `\`\`\`${reason}\`\`\``, inline: false }
                )
                .setFooter({ text: 'Pending Management Approval', iconURL: interaction.guild?.iconURL() || undefined })
                .setTimestamp();

            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId(`BTN_LOA_APPROVE_${userId}`)
                    .setLabel('Approve Request')
                    .setEmoji('✅')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`BTN_LOA_DENY_${userId}`)
                    .setLabel('Deny Request')
                    .setEmoji('⛔')
                    .setStyle(ButtonStyle.Danger)
            );
            
            await mgmtChannel.send({ content: `<@&${mgmtRoleId}>`, embeds: [embed], components: [row] });
            await interaction.editReply({ 
                content: "✅ **Request Submitted.** Your LOA request has been sent to management for review." 
            });

        } else if (sub === 'return') {
            if (!userData.loaStatus?.isActive) {
                 return interaction.editReply("⚠️ You are not currently marked as being on LOA.");
            }

            await client.database.updateUser(userId, { loaStatus: { isActive: false, since: null, reason: null } });
            
            const mgmtChannel = await client.channels.fetch(staffConfig.channels.management) as TextChannel;
            
            if (mgmtChannel) {
                const returnEmbed = new EmbedBuilder()
                    .setTitle('👋 Staff Return Notification')
                    .setColor(0x00AA00) 
                    .setDescription(`**${interaction.user.tag}** has marked themselves as returned from LOA.`)
                    .addFields(
                        { name: 'Staff Member', value: `<@${userId}>`, inline: true },
                        { name: 'Status', value: '✅ Active Duty', inline: true }
                    )
                    .setTimestamp();

                await mgmtChannel.send({ embeds: [returnEmbed] });
            }
            
            await interaction.editReply("✅ **Welcome Back!** Your status has been updated to Active.");
        }
    }
};

export default loaCommand;
