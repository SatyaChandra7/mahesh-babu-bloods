// No need for node-fetch in Node.js 18+

const API_BASE = 'http://localhost:5000';

async function testRegistration() {
    console.log('--- Testing Donor Registration ---');
    const donorData = {
        fullName: 'Test Donor ' + Date.now(),
        dateOfBirth: '1990-01-01',
        gender: 'Male',
        phoneNumber: '9000000001',
        bloodGroup: 'B+',
        address: {
            state: 'Telangana',
            district: 'Hyderabad',
            mandal: 'Jubilee Hills',
            village: 'Road No 36'
        }
    };

    try {
        const res = await fetch(`${API_BASE}/api/donors`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(donorData)
        });

        const result = await res.json();
        if (result.success) {
            console.log('✅ Registration Successful!');
            console.log('Donor ID:', result.donor.id);
            return result.donor.id;
        } else {
            console.error('❌ Registration Failed:', result.message);
        }
    } catch (err) {
        console.error('❌ Request Error:', err.message);
    }
}

async function testSearch() {
    console.log('\n--- Testing Public Search ---');
    try {
        const params = new URLSearchParams({ bloodGroup: 'B+', address: 'Hyderabad' });
        const res = await fetch(`${API_BASE}/api/public/donors?${params.toString()}`);
        const result = await res.json();
        if (result.success) {
            console.log(`✅ Search Successful! Found ${result.donors.length} donors.`);
            result.donors.forEach(d => console.log(` - ${d.fullName} (${d.bloodGroup}) at ${d.district}`));
        } else {
            console.error('❌ Search Failed:', result.message);
        }
    } catch (err) {
        console.error('❌ Request Error:', err.message);
    }
}

async function runTests() {
    await testRegistration();
    await testSearch();
}

runTests();
