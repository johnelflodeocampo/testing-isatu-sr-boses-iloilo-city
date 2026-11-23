const isatuEmailPattern = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@(students\.)?isatu\.edu\.ph$/i;

function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && isatuEmailPattern.test(email) ? email : null;
}

function normalizeStudentEmail(value) {
  const email = normalizeEmail(value);
  return email && (
    email.endsWith('@students.isatu.edu.ph')
    || email.endsWith('@isatu.edu.ph')
  ) ? email : null;
}

function normalizeOfficerEmail(value) {
  const email = normalizeEmail(value);
  return email && (
    email.endsWith('@isatu.edu.ph')
    || email.endsWith('@students.isatu.edu.ph')
  ) ? email : null;
}

module.exports = {
  normalizeEmail,
  normalizeOfficerEmail,
  normalizeStudentEmail,
};
