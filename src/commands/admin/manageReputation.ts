import { ApplicationCommandOptionType, CommandInteraction, EmbedBuilder, PermissionFlagsBits, AutocompleteInteraction, TextChannel, GuildMember } from 'discord.js';
import { IApplicationCommand } from '../../core/IApplicationCommand';
import { CustomClient } from '../../types';
import { StaffLogic, staffConfig } from '../../utils/StaffLogic';
import { errorTracker } from '../../core/errorTracker';

const manageReputation: IApplicationCommand = {
    data: {
        name: 'manage_reputation',
        description: 'Manually add or remove specific amounts of reputation points.',
        options: [
            {
                name: 'type',
                description: 'Which type of points to modify.',
                type: ApplicationCommandOptionType.String,
                required: true,
                choices: [
                    { name: 'Positive Points (Green)', value: 'POS' },
                    { name: 'Negative Strikes (Red)', value: 'NEG' }
                ]
            },
            {
                name: 'action',
                description: 'Add or Remove points?',
                type: ApplicationCommandOptionType.String,
                required: true,
                choices: [
                    { name: 'Add (Increase)', value: 'ADD' },
                    { name: 'Remove (Decrease)', value: 'REMOVE' }
                ]
            },
            {
                name: 'amount',
                description: 'How many points?',
                type: ApplicationCommandOptionType.Integer,
                required: true,
                min_value: 1
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
                description: 'Reason for this manual adjustment.',
                type: ApplicationCommandOptionType.String,
                required: true
            }
        ]
    },
    permissions: 'admin',
    defaultMemberPermissions: PermissionFlagsBits.Administrator,

    async autocomplete(interaction: AutocompleteInteraction, client: CustomClient) {
        const focusedValue = interaction.options.getFocused().toLowerCase();
        const guild = interaction.guild;
        if (!guild) return;

        const staffRoleIds = staffConfig.roles.staffHierarchy.map((r: any) => r.id);
        const members = await guild.members.fetch(); 
        
        const filtered = members.filter(member => 
            member.roles.cache.hasAny(...staffRoleIds) && 
            (member.user.username.toLowerCase().includes(focusedValue) || member.nickname?.toLowerCase().includes(focusedValue))
        );

        await interaction.respond(
            filtered.first(25).map(m => ({ name: `${m.user.username} [${m.roles.highest.name}]`, value: m.id }))
        );
    },

    async execute(interaction: CommandInteraction, client: CustomClient) {
        if (!interaction.isChatInputCommand()) return;
        await interaction.deferReply();

        const type = interaction.options.getString('type', true);
        const action = interaction.options.getString('action', true);
        const amount = interaction.options.getInteger('amount', true);
        const targetId = interaction.options.getString('staff', true);
        const reason = interaction.options.getString('reason', true);
        
        const executor = interaction.member as GuildMember;
        const staffRoleIds = staffConfig.roles.staffHerarchy.map((r: any) => r.id);

        try {
            if (targetId === interaction.user.id ) {
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
            if (!targetMember) return interaction.editReply("❌ Member not found in guild.");

            if (!targetMember.roles.cache.hasAny(...staffRoleIds)) {
                return interaction.editReply(`❌ **Invalid Target:** <@${targetMember.id}> is not a recognized staff member.`);
            }

            const userData = await client.database.getOrCreateUser(targetId);

            let currentPos = userData.positiveRep || 0;
            let currentNeg = userData.negativeRep || 0;
            let newPos = currentPos;
            let newNeg = currentNeg;

            if (type === 'POS') {
                if (action === 'ADD') {
                    newPos += amount;
                } else {
                    newPos -= amount;
                    if (newPos < 0) newPos = 0;
                }
            } else {
                if (action === 'ADD') {
                    newNeg += amount;
                } else {
                    newNeg -= amount;
                    if (newNeg < 0) newNeg = 0;
                }
            }

            await client.database.updateUser(targetId, { positiveRep: newPos, negativeRep: newNeg });

            await StaffLogic.addLog(client, targetId, {
                timestamp: Date.now(),
                moderatorId: interaction.user.id,
                action: 'RESET',
                amount: amount,
                reason: `Manual Adjustment (${action} ${amount} ${type}): ${reason}`
            });

            const logChannel = await client.channels.fetch(staffConfig.channels.log) as TextChannel;
            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setTitle('🛠️ Manual Reputation Adjustment')
                    .setColor(0xFFA500)
                    .setThumbnail(targetMember.user.displayAvatarURL())
                    .addFields(
                        { name: 'Staff', value: `${targetMember.user.tag}`, inline: true },
                        { name: 'Executor', value: `${interaction.user.tag} ${isDeveloper ? '(Dev)' : ''}`, inline: true },
                        { name: 'Adjustment', value: `${action === 'ADD' ? '+' : '-'}${amount} ${type === 'POS' ? 'Positive' : 'Negative'} Points`, inline: true },
                        { name: 'Old Totals', value: `✅ ${currentPos} | ❌ ${currentNeg}`, inline: true },
                        { name: 'New Totals', value: `✅ ${newPos} | ❌ ${newNeg}`, inline: true },
                        { name: 'Reason', value: reason, inline: false }
                    )
                    .setTimestamp();
                await logChannel.send({ embeds: [logEmbed] });
            }

            try {
                const dmEmbed = new EmbedBuilder()
                    .setTitle('🛡️ Reputation Adjusted')
                    .setDescription(`An administrator has manually adjusted your reputation points.`)
                    .addFields(
                        { name: 'Change', value: `${action === 'ADD' ? '+' : '-'}${amount} ${type === 'POS' ? 'Positive Points' : 'Negative Strikes'}` },
                        { name: 'Reason', value: reason }
                    )
                    .setColor(0xFFA500);
                await targetMember.send({ embeds: [dmEmbed] });
            } catch (e) {}

            await interaction.editReply(`✅ **Adjustment Complete.**\n**User:** ${targetMember.user.username}\n**Old:** ✅ ${currentPos} | ❌ ${currentNeg}\n**New:** ✅ ${newPos} | ❌ ${newNeg}`);

        } catch (error) {
            const errorId = errorTracker.trackError(error, 'command');
            await interaction.editReply(`❌ Error (ID: ${errorId})`);
        }
    }
};

export default manageReputation;
