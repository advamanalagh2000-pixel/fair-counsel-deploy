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
    const verified = [
      { name: 'Adv. Meera Kulkarni', phone: '9800000001', init: 'MK', specs: ['Family Law', 'Personal Laws'], city: 'Jaipur', langs: ['Hindi', 'English'], experienceYears: 4, badge: 'fave', consultationsCompleted: 46, feePaise: 100000, bar: 'RAJ/1284/2013',
        bio: 'Focuses on mutual consent and contested divorce matters, with a mediation-first approach where possible.', turnaround: '3-5 working days', starting: '₹12,000 for mutual consent drafting' },
      { name: 'Adv. Vikram Rathi', phone: '9800000002', init: 'VR', specs: ['Family Law', 'Real Estate & Property Law'], city: 'Jaipur', langs: ['Hindi'], experienceYears: 5, badge: 'verified', consultationsCompleted: 22, feePaise: 80000, bar: 'RAJ/2041/2018',
        bio: 'Handles matrimonial matters alongside property disputes, common in joint-family settlement cases.', turnaround: '4-6 working days', starting: '₹10,000 for mutual consent drafting' },
      { name: 'Adv. Amandeep Kaur', phone: '9800000003', init: 'AK', specs: ['Family Law', 'Civil Litigation'], city: 'Delhi', langs: ['English'], experienceYears: 3, badge: 'fave', consultationsCompleted: 61, feePaise: 120000, bar: 'DEL/0876/2009',
        bio: 'Senior counsel with extensive family court experience, takes on contested and cross-border matters.', turnaround: '2-4 working days', starting: '₹15,000 for mutual consent drafting' },
      { name: 'Adv. Rohan Deshpande', phone: '9800000004', init: 'RD', specs: ['Real Estate & Property Law', 'Infrastructure & Construction Law'], city: 'Pune', langs: ['Marathi', 'Hindi', 'English'], experienceYears: 4, badge: 'verified', consultationsCompleted: 34, feePaise: 70000, bar: 'MAH/1284/2016',
        bio: 'Drafts and reviews rent agreements and handles landlord-tenant disputes across Maharashtra.', turnaround: '2-3 working days', starting: '₹2,800 for rent agreement drafting' },
      { name: 'Adv. Sana Fatima', phone: '9800000005', init: 'SF', specs: ['Corporate & Commercial Law', 'Company Law', 'Intellectual Property Rights (IPR)'], city: 'Hyderabad', langs: ['English', 'Hindi'], experienceYears: 5, badge: 'verified', consultationsCompleted: 29, feePaise: 110000, bar: 'TS/0932/2017',
        bio: 'Works with early-stage startups on incorporation, contracts, and trademark filing.', turnaround: '4-7 working days', starting: '₹8,500 for trademark filing' },
      { name: 'Adv. Karthik Iyer', phone: '9800000006', init: 'KI', specs: ['Criminal Law', 'Banking & Finance Law'], city: 'Bengaluru', langs: ['Kannada', 'English', 'Hindi'], experienceYears: 4, badge: 'fave', consultationsCompleted: 53, feePaise: 130000, bar: 'KAR/0451/2011',
        bio: 'Defends cheque-bounce and criminal matters in Karnataka courts, with a strong trial record.', turnaround: '5-8 working days', starting: '₹7,000 for cheque bounce notice and filing' },
      { name: 'Adv. Priya Nair', phone: '9800000007', init: 'PN', specs: ['Employment & Labour Law', 'Regulatory & Compliance'], city: 'Kochi', langs: ['Malayalam', 'English'], experienceYears: 10, badge: 'verified', consultationsCompleted: 31, feePaise: 90000, bar: 'KER/1123/2014',
        bio: 'Advises employers and employees on termination disputes, POSH compliance, and severance negotiation.', turnaround: '3-5 working days', starting: '₹6,000 for termination review' },
      { name: 'Adv. Arjun Malhotra', phone: '9800000008', init: 'AM', specs: ['Taxation Law', 'Securities & Capital Markets Law'], city: 'Mumbai', langs: ['Hindi', 'English'], experienceYears: 16, badge: 'fave', consultationsCompleted: 72, feePaise: 150000, bar: 'MAH/0442/2008',
        bio: 'Handles direct tax disputes and SEBI compliance for listed companies and promoters.', turnaround: '5-9 working days', starting: '₹20,000 for tax notice response' },
      { name: 'Adv. Neha Kapoor', phone: '9800000009', init: 'NK', specs: ['Consumer Protection Law'], city: 'Mumbai', langs: ['Hindi', 'English', 'Marathi'], experienceYears: 5, badge: 'verified', consultationsCompleted: 18, feePaise: 60000, bar: 'MAH/3391/2020',
        bio: 'Represents consumers before district and state consumer forums for defective goods and deficient service.', turnaround: '3-6 working days', starting: '₹3,500 for consumer complaint drafting' },
      { name: 'Adv. Sandeep Verma', phone: '9800000010', init: 'SV', specs: ['Insolvency & Bankruptcy Law', 'NCLT & NCLAT Practice'], city: 'Delhi', langs: ['Hindi', 'English'], experienceYears: 12, badge: 'verified', consultationsCompleted: 27, feePaise: 140000, bar: 'DEL/2210/2012',
        bio: 'Represents financial creditors and corporate debtors in NCLT insolvency resolution proceedings.', turnaround: '6-10 working days', starting: '₹25,000 for CIRP filing review' },
      { name: 'Adv. Divya Reddy', phone: '9800000011', init: 'DR', specs: ['Information Technology & Cyber Law', 'Data Protection & Privacy Law'], city: 'Hyderabad', langs: ['Telugu', 'English'], experienceYears: 6, badge: 'verified', consultationsCompleted: 15, feePaise: 85000, bar: 'TS/1765/2019',
        bio: 'Advises tech companies on DPDP Act compliance, data breach response, and cyber fraud complaints.', turnaround: '3-5 working days', starting: '₹9,000 for privacy policy review' },
      { name: 'Adv. Farhan Sheikh', phone: '9800000012', init: 'FS', specs: ['Motor Accident Claims', 'Insurance Law'], city: 'Lucknow', langs: ['Hindi', 'Urdu', 'English'], experienceYears: 9, badge: 'verified', consultationsCompleted: 24, feePaise: 55000, bar: 'UP/0987/2016',
        bio: 'Files motor accident claims tribunal petitions and disputes insurance claim rejections.', turnaround: '4-7 working days', starting: '₹4,500 for MACT petition filing' },
      { name: 'Adv. Gayatri Joshi', phone: '9800000013', init: 'GJ', specs: ['Wills, Trusts & Estate Planning', 'Succession & Inheritance Law'], city: 'Ahmedabad', langs: ['Gujarati', 'Hindi', 'English'], experienceYears: 14, badge: 'fave', consultationsCompleted: 41, feePaise: 95000, bar: 'GUJ/0654/2010',
        bio: 'Drafts wills and family settlement deeds, and advises on contested succession matters.', turnaround: '3-6 working days', starting: '₹5,500 for will drafting' },
      { name: 'Adv. Rahul Chatterjee', phone: '9800000014', init: 'RC', specs: ['Media & Entertainment Law', 'Intellectual Property Rights (IPR)'], city: 'Kolkata', langs: ['Bengali', 'Hindi', 'English'], experienceYears: 8, badge: 'verified', consultationsCompleted: 20, feePaise: 100000, bar: 'WB/1456/2017',
        bio: 'Negotiates content licensing and talent contracts, and files copyright and trademark disputes.', turnaround: '4-7 working days', starting: '₹11,000 for contract review' },
      { name: 'Adv. Simran Kaur', phone: '9800000015', init: 'SK', specs: ['Immigration & Citizenship Law', 'International Law'], city: 'Chandigarh', langs: ['Punjabi', 'Hindi', 'English'], experienceYears: 7, badge: 'verified', consultationsCompleted: 19, feePaise: 75000, bar: 'PUN/2233/2018',
        bio: 'Advises on visa refusals, OCI applications, and cross-border family reunification cases.', turnaround: '4-6 working days', starting: '₹6,500 for visa refusal appeal' },
      { name: 'Adv. Manoj Pillai', phone: '9800000016', init: 'MP', specs: ['Environmental Law', 'Public Interest Litigation (PIL)'], city: 'Chennai', langs: ['Tamil', 'English'], experienceYears: 18, badge: 'fave', consultationsCompleted: 38, feePaise: 105000, bar: 'TN/0321/2006',
        bio: 'Litigates environmental clearance challenges and public interest matters before High Courts.', turnaround: '5-9 working days', starting: '₹14,000 for representation drafting' },
      { name: 'Adv. Kavya Menon', phone: '9800000017', init: 'KM', specs: ['Healthcare & Medical Law', 'Pharmaceutical & Life Sciences Law'], city: 'Kochi', langs: ['Malayalam', 'English'], experienceYears: 10, badge: 'verified', consultationsCompleted: 23, feePaise: 98000, bar: 'KER/1890/2014',
        bio: 'Advises hospitals and clinics on medical negligence claims and regulatory compliance.', turnaround: '4-7 working days', starting: '₹9,500 for compliance review' },
      { name: 'Adv. Yash Agarwal', phone: '9800000018', init: 'YA', specs: ['White-Collar Crime & Economic Offences', 'Anti-Money Laundering (PMLA)'], city: 'Delhi', langs: ['Hindi', 'English'], experienceYears: 20, badge: 'fave', consultationsCompleted: 65, feePaise: 180000, bar: 'DEL/0112/2004',
        bio: 'Defends corporate clients and individuals in ED and economic offences wing investigations.', turnaround: '6-10 working days', starting: '₹30,000 for case strategy consultation' }
    ];

    for (const l of verified) {
      await prisma.lawyer.create({
        data: {
          name: l.name, phone: l.phone, init: l.init,
          tags: fromArr(l.specs), specs: fromArr(l.specs), langs: fromArr(l.langs),
          city: l.city, experienceYears: l.experienceYears, badge: l.badge,
          consultationsCompleted: l.consultationsCompleted, feePaise: l.feePaise, bar: l.bar,
          bio: l.bio, turnaround: l.turnaround, starting: l.starting,
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
    console.log('Lawyer login demo numbers: 9800000001 through 9800000018 (all verified, password-free OTP login).');
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
