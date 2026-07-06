const http = require('http');

const testDonor = JSON.stringify({
    fullName: "Mahesh Babu Fan",
    dateOfBirth: "1985-08-09",
    phoneNumber: "9848022338",
    bloodGroup: "O+",
    address: {
        state: "Telangana",
        district: "Hyderabad",
        mandal: "Jubilee Hills",
        village: "Road No 45"
    }
});

const options = {
    hostname: '127.0.0.1',
    port: 5000,
    path: '/api/donors',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': testDonor.length
    }
};

const req = http.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
        console.log('Registration Status:', res.statusCode);
        console.log('Response:', JSON.parse(data));
        
        // Fetch count
        http.get('http://127.0.0.1:5000/api/donors/count', (res2) => {
            let data2 = '';
            res2.on('data', (chunk) => { data2 += chunk; });
            res2.on('end', () => {
                console.log('\nUpdated Donor Count:', JSON.parse(data2).count);
            });
        });
    });
});

req.on('error', (e) => {
    console.error(`Request Error: ${e.message}`);
});

req.write(testDonor);
req.end();
