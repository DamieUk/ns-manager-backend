// TODO: implement real auth logic (hashing, JWT, sessions, etc.)

async function register(req, res) {
  res.status(501).json({ message: 'TODO: register not implemented yet' });
}

async function login(req, res) {
  res.status(501).json({ message: 'TODO: login not implemented yet' });
}

module.exports = { register, login };
