const bcrypt = require('bcryptjs');
const { prisma, fromArr } = require('./prisma');

async function seed() {
  // --- Admin account ---
  const adminCount = await prisma.admin.count();
  if (adminCount === 0) {
    await prisma.admin.create({
      data: { username: 'admin', passwordHash: bcrypt.hashSync('admin123', 8), role: 'superadmin' }
    });
    console.log('Seeded superadmin account, username: admin / password: admin123 (CHANGE THIS before any real deployment)');
  }

  // --- Sample lawyers, spread across the practice-area taxonomy ---
  // Phone numbers are fake 98000000xx test numbers, used to demo lawyer login
  // (POST /api/auth/lawyer/send-otp with one of these, then the devOtp echoed back).
  const lawyerCount = await prisma.lawyer.count();
  if (lawyerCount === 0) {
    // Only the 4 real, currently-onboarded lawyers. pinned:true keeps a
    // profile first in "recommended" sort regardless of the usual
    // fave-badge/experience ordering (see routes/lawyers.js).
    const verified = [
      { name: 'Adv. Amandeep Kaur', phone: '9800000003', init: 'AK', specs: ['Family Law', 'Civil Litigation'], city: 'Delhi', langs: ['English'], experienceYears: 3, badge: 'fave', consultationsCompleted: 61, feePaise: 120000, bar: 'DEL/0876/2009', pinned: true,
        bio: 'Senior counsel with extensive family court experience, takes on contested and cross-border matters.', turnaround: '2-4 working days', starting: '₹15,000 for mutual consent drafting' },
      { name: 'Adv. Meera Kulkarni', phone: '9800000001', init: 'MK', specs: ['Family Law', 'Personal Laws'], city: 'Jaipur', langs: ['Hindi', 'English'], experienceYears: 4, badge: 'fave', consultationsCompleted: 46, feePaise: 100000, bar: 'RAJ/1284/2013',
        bio: 'Focuses on mutual consent and contested divorce matters, with a mediation-first approach where possible.', turnaround: '3-5 working days', starting: '₹12,000 for mutual consent drafting' },
      { name: 'Adv. Karthik Iyer', phone: '9800000006', init: 'KI', specs: ['Criminal Law', 'Banking & Finance Law'], city: 'Bengaluru', langs: ['Kannada', 'English', 'Hindi'], experienceYears: 4, badge: 'fave', consultationsCompleted: 53, feePaise: 130000, bar: 'KAR/0451/2011',
        bio: 'Defends cheque-bounce and criminal matters in Karnataka courts, with a strong trial record.', turnaround: '5-8 working days', starting: '₹7,000 for cheque bounce notice and filing' },
      { name: 'Adv. Rohan Deshpande', phone: '9800000004', init: 'RD', specs: ['Real Estate & Property Law', 'Infrastructure & Construction Law'], city: 'Pune', langs: ['Marathi', 'Hindi', 'English'], experienceYears: 4, badge: 'verified', consultationsCompleted: 34, feePaise: 70000, bar: 'MAH/1284/2016',
        bio: 'Drafts and reviews rent agreements and handles landlord-tenant disputes across Maharashtra.', turnaround: '2-3 working days', starting: '₹2,800 for rent agreement drafting' }
    ];

    for (const l of verified) {
      await prisma.lawyer.create({
        data: {
          name: l.name, phone: l.phone, init: l.init,
          tags: fromArr(l.specs), specs: fromArr(l.specs), langs: fromArr(l.langs),
          city: l.city, experienceYears: l.experienceYears, badge: l.badge,
          consultationsCompleted: l.consultationsCompleted, feePaise: l.feePaise, bar: l.bar,
          bio: l.bio, turnaround: l.turnaround, starting: l.starting,
          pinned: !!l.pinned,
          status: 'verified'
        }
      });
    }

    // Lawyers sitting in the verification queue, so /api/admin/lawyers/pending has something to show.
    await prisma.lawyer.create({
      data: {
        name: 'Adv. Ritika Bose', phone: '9800000090', init: 'RB',
        tags: fromArr(['Sports Law']), specs: fromArr(['Sports Law']), langs: fromArr(['Bengali', 'English']),
        city: 'Kolkata', experienceYears: 4, badge: 'verified', consultationsCompleted: 0, feePaise: 65000,
        bar: 'WB/4210/2022', status: 'pending'
      }
    });
    await prisma.lawyer.create({
      data: {
        name: 'Adv. Suresh Nambiar', phone: '9800000091', init: 'SN',
        tags: fromArr(['Aviation Law', 'Maritime & Admiralty Law']), specs: fromArr(['Aviation Law', 'Maritime & Admiralty Law']), langs: fromArr(['English', 'Malayalam']),
        city: 'Kochi', experienceYears: 11, badge: 'verified', consultationsCompleted: 0, feePaise: 120000,
        bar: 'KER/0765/2013', status: 'pending'
      }
    });

    console.log(`Seeded ${verified.length} verified lawyers across ${new Set(verified.flatMap(l => l.specs)).size} practice areas, plus 2 pending verification.`);
    console.log('Lawyer login demo numbers: ' + verified.map(l => l.phone).join(', ') + ' (password-free OTP login).');
  }

  console.log('Seed complete.');
}

module.exports = { seed };

// Runs automatically when invoked directly (`npm run seed`), but not when
// required by server.js's own startup bootstrap (which manages its own
// prisma connection lifecycle).
if (require.main === module) {
  seed()
    .catch(e => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
