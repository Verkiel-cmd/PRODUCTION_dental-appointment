const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');

test('index.html exists', () => 
    expect(html.length).toBeGreaterThan(0));
test('has booking form', () => { 
    expect(html).toContain('<form'); expect(html).toContain('onsubmit'); });
test('has fields', () => 
    { for (const id of ['fullname','service','date','time']) expect(html).toContain(`id="${id}"`); });
test('has OTP fields', () => 
    { for (const id of ['phone','otp']) expect(html).toContain(`id="${id}"`); });