const crypto = require('crypto');

const boundary = 'batch_boundary_xxx';
let body = '';
[1, 2].forEach((id, index) => {
body += `--${boundary}\r\n`;
body += `Content-Type: application/http\r\n`;
body += `Content-ID: <item-${index}>\r\n\r\n`;
body += `GET /gmail/v1/users/me/messages/${id}?format=metadata HTTP/1.1\r\n\r\n`;
});
body += `--${boundary}--\r\n`;

console.log(body);

// simulating response
const res = `
--batch_boundary_xxx
Content-Type: application/http
Content-ID: <response-item-0>

HTTP/1.1 200 OK
Content-Type: application/json; charset=UTF-8

{
 "id": "1",
 "payload": { "headers": [] }
}
--batch_boundary_xxx
Content-Type: application/http
Content-ID: <response-item-1>

HTTP/1.1 200 OK
Content-Type: application/json; charset=UTF-8

{
 "id": "2",
 "payload": { "headers": [] }
}
--batch_boundary_xxx--
`;

// Extract boundary
const resBoundaryMatch = res.match(/--batch_[^\r\n]+/);
const resBoundary = resBoundaryMatch ? resBoundaryMatch[0] : `--${boundary}`;

const parts = res.split(resBoundary);
const messages = [];
parts.forEach(part => {
    if (part.includes('HTTP/1.1 200 OK')) {
        const match = part.match(/\{[\s\S]*\}/);
        if (match) {
            messages.push(JSON.parse(match[0]));
        }
    }
});

console.log(messages);
