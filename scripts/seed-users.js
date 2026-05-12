import { prisma } from '../db/database-prisma.js';

async function seedUsers() {
    try {
        console.log('🌱 Starting user seed...\n');

        // Check if admin user already exists
        const existingAdmin = await prisma.user.findFirst({
            where: { email: 'admin@livesupport.com' }
        });

        if (existingAdmin) {
            console.log('✅ Admin user already exists:', existingAdmin.email);
            return;
        }

        // Create admin user
        const adminUser = await prisma.user.create({
            data: {
                email: 'admin@livesupport.com',
                password: 'admin123', // Change this in production!
                name: 'Admin User',
                role: 'admin'
            }
        });

        console.log('✅ Created admin user:');
        console.log('   Email:', adminUser.email);
        console.log('   Name:', adminUser.name);
        console.log('   Role:', adminUser.role);
        console.log('   ID:', adminUser.id);

        // Create the requested Cyber admin user
        const cyberAdminEmail = 'cyberincognito15@gmail.com';
        const existingCyberAdmin = await prisma.user.findFirst({
            where: { email: cyberAdminEmail }
        });
        if (!existingCyberAdmin) {
            const cyberAdmin = await prisma.user.create({
                data: {
                    name: 'Cyber',
                    email: cyberAdminEmail,
                    password: '110089',
                    role: 'admin'
                }
            });
            console.log('✅ Created requested admin user:');
            console.log('   Email:', cyberAdmin.email);
            console.log('   Name:', cyberAdmin.name);
            console.log('   Role:', cyberAdmin.role);
            console.log('   ID:', cyberAdmin.id);
        } else {
            console.log('✅ Requested admin user already exists:', existingCyberAdmin.email);
        }

        // Create a few test agents
        const testAgents = [
            { email: 'agent1@livesupport.com', name: 'John Agent', role: 'agent' },
            { email: 'agent2@livesupport.com', name: 'Jane Staff', role: 'agent' },
            { email: 'viewer@livesupport.com', name: 'View Only', role: 'viewer' },
            { email: 'support@livesupport.com', name: 'Support Agent', role: 'agent' }
        ];

        for (const agent of testAgents) {
            const existing = await prisma.user.findFirst({
                where: { email: agent.email }
            });

            if (!existing) {
                const created = await prisma.user.create({
                    data: {
                        ...agent,
                        password: 'password123' // Change this in production!
                    }
                });
                console.log(`✅ Created ${agent.role}:`, created.email);
            }
        }

        console.log('\n🎉 User seed completed successfully!\n');
        console.log('Test credentials:');
        console.log('  Admin: admin@livesupport.com / admin123');
        console.log('  Agent: agent1@livesupport.com / password123');
        console.log('\n⚠️  Change these passwords in production!');

        await prisma.$disconnect();
    } catch (error) {
        console.error('❌ Seed error:', error);
        await prisma.$disconnect();
        process.exit(1);
    }
}

seedUsers();
