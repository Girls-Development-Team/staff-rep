import { 
    ApplicationCommandOptionType, 
    CommandInteraction, 
    EmbedBuilder, 
    PermissionFlagsBits, 
    AutocompleteInteraction, 
    TextChannel, 
    GuildMember,
    Colors
} from 'discord.js';
import { IApplicationCommand } from '../../core/IApplicationCommand';
import { CustomClient } from '../../types';
import { StaffLogic, staffConfig } from '../../utils/StaffLogic';
import { errorTracker } from '../../core/errorTracker';

const REPUTATION_ACTIONS = {
    ADD: { value: 'add', label: 'Give Point (Positive)', dbField: 'positiveRep', logType: 'ADD_POS', color: Colors.Green, symbol: '✅' },
    REMOVE: { value: 'remove', label: 'Give Strike (Negative)', dbField: 'negativeRep', logType: 'ADD_NEG', color: Colors.Red, symbol: '⚠️' }
} as const;

const reputationCommand: IApplicationCommand = {
    data: {
        name: 'reputation',
        description: 'Manage staff reputation points.',
        options: [
            {
                name: 'action',
                description: 'Give or remove points.',
                type: ApplicationCommandOptionType.String,
                required: true,
                choices: [
                    { name: REPUTATION_ACTIONS.ADD.label, value: REPUTATION_ACTIONS.ADD.value },
                    { name: REPUTATION_ACTIONS.REMOVE.label, value: REPUTATION_ACTIONS.REMOVE.value }
                ]
            },
            {
                name: 'staff',
                description: 'The staff member.',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
            },
            {
                name: 'reason',
                description: 'MANDATORY reason for the change.',
                type: ApplicationCommandOptionType.String,
                required: true
            }
        ]
    },
    permissions: 'admin',
    defaultMemberPermissions: PermissionFlagsBits.ManageRoles,

    async autocomplete(interaction: AutocompleteInteraction, client: CustomClient) {
        const focusedValue = interaction.options.getFocused().toLowerCase();
        const guild = interaction.guild;
        if (!guild) return;

        try {
            const staffRoleIds = staffConfig.roles.staffHierarchy.map((r: any) => r.id);

            const searchOptions = { query: focusedValue, limit: 50 };
            const members = await guild.members.search(searchOptions);

            const filtered = members.filter(member => 
                member.roles.cache.hasAny(...staffRoleIds)
            );

            await interaction.respond(
                filtered.first(25).map(m => ({ 
                    name: `${m.user.username} [${m.roles.highest.name}]`, 
                    value: m.id 
                }))
            );
        } catch (error) {
            await interaction.respond([]); 
        }
    },

    async execute(interaction: CommandInteraction, client: CustomClient) {
        if (!interaction.isChatInputCommand() || !interaction.inGuild()) return;
        
        await interaction.deferReply();

        const actionValue = interaction.options.getString('action', true);
        const targetId = interaction.options.getString('staff', true);
        const reason = interaction.options.getString('reason', true);
        const executor = interaction.member as GuildMember;
        const staffRoleIds = staffConfig.roles.staffHierarchy.map((r: any) => r.id);

        try {
            if (targetId === interaction.user.id) {
                return interaction.editReply("❌ **Anti-Abuse:** You cannot edit your own reputation.");
            }

            const isDeveloper = staffConfig.developerIds.includes(interaction.user.id);
            const isManager = executor.roles.cache.has(staffConfig.roles.manager);

            if (!isDeveloper && !isManager) {
                return interaction.editReply({
                    content: "❌ **Access Denied:** This command is restricted to **Managers** only."
                });
            }

            const targetMember = await interaction.guild?.members.fetch(targetId).catch(() => null);
            if (!targetMember) {
                return interaction.editReply("❌ **Error:** Member not found in this guild.");
            }

            if (!targetMember.roles.cache.hasAny(...staffRoleIds)) {
                return interaction.editReply(`❌ **Invalid Target:** ${targetMember} does not hold any configured Staff Roles.`);
            }

            const userData = await client.database.getOrCreateUser(targetId);

            if (userData.loaStatus?.isActive) {
                return interaction.editReply({
                    content: `❌ **Action Blocked:** Staff member is on **LOA**.\n> **Reason:** ${userData.loaStatus.reason}`
                });
            }

            const actionContext = actionValue === REPUTATION_ACTIONS.ADD.value 
                ? REPUTATION_ACTIONS.ADD 
                : REPUTATION_ACTIONS.REMOVE;

            const currentVal = userData[actionContext.dbField as keyof typeof userData] || 0;
            const newVal = Number(currentVal) + 1;
            
            const dbUpdate = { [actionContext.dbField]: newVal };

            await client.database.updateUser(targetId, dbUpdate);
            
            await StaffLogic.addLog(client, targetId, {
                timestamp: Date.now(),
                moderatorId: interaction.user.id,
                action: actionContext.logType,
                amount: 1,
                reason: reason
            });

            const finalPos = actionContext === REPUTATION_ACTIONS.ADD ? newVal : (userData.positiveRep || 0);
            const finalNeg = actionContext === REPUTATION_ACTIONS.REMOVE ? newVal : (userData.negativeRep || 0);

            const logChannelId = staffConfig.channels.log;
            if (logChannelId) {
                const logChannel = await client.channels.fetch(logChannelId) as TextChannel;
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setTitle(`${actionContext.symbol} Staff Reputation Update`)
                        .setColor(actionContext.color)
                        .setThumbnail(targetMember.user.displayAvatarURL())
                        .addFields(
                            { name: 'Staff Member', value: `${targetMember} (\`${targetMember.id}\`)`, inline: true },
                            { name: 'Manager', value: `${interaction.user} (\`${interaction.user.id}\`)`, inline: true },
                            { name: 'Action', value: actionContext.label, inline: true },
                            { name: 'Reason', value: reason, inline: false },
                            { name: 'New Standing', value: `✅ Positive: **${finalPos}**\n❌ Negative: **${finalNeg}**`, inline: false }
                        )
                        .setTimestamp();
                    
                    await logChannel.send({ embeds: [logEmbed] }).catch(() => console.warn('Failed to send log embed'));
                }
            }

            await StaffLogic.checkThreshold(client, targetMember, { ...userData, ...dbUpdate }, reason);

            let dmStatus = "✅ Notified user via DM.";
            try {
                const dmEmbed = new EmbedBuilder()
                    .setTitle(`${actionContext.symbol} Staff Reputation Update`)
                    .setColor(actionContext.color)
                    .setDescription(`Your staff reputation in **${interaction.guild?.name}** has been updated.`)
                    .addFields(
                        { name: 'Type', value: actionContext.label, inline: true },
                        { name: 'Moderator', value: interaction.user.tag, inline: true },
                        { name: 'Reason', value: reason, inline: false }
                    )
                    .setFooter({ text: 'Please contact management if you believe this is an error.' })
                    .setTimestamp();

                await targetMember.send({ embeds: [dmEmbed] });
            } catch (err) {
                dmStatus = "⚠️ Could not DM user (DMs likely closed).";
            }

            const responseEmbed = new EmbedBuilder()
                .setColor(actionContext.color)
                .setDescription(
                    `### ${actionContext.symbol} Reputation Updated\n` +
                    `**Staff:** ${targetMember}\n` +
                    `**Action:** ${actionContext.label}\n` +
                    `**New Totals:** ✅ ${finalPos} | ❌ ${finalNeg}\n\n` +
                    `*${dmStatus}*`
                );

            await interaction.editReply({ embeds: [responseEmbed] });

        } catch (error) {
            const errorId = errorTracker.trackError(error, 'command');
            
            const replyMethod = interaction.replied || interaction.deferred ? 'editReply' : 'reply';
            await interaction[replyMethod]({ 
                content: `❌ **System Error:** An unexpected error occurred. (ID: \`${errorId}\`)`, 
                ephemeral: true 
            });
        }
    }
};

export default reputationCommand;
