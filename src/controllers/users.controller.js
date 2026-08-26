// TODO: implement real logic against the User model

async function listUsers(req, res) {
  res.status(501).json({ message: 'TODO: listUsers not implemented yet' });
}

async function getUserById(req, res) {
  res.status(501).json({ message: `TODO: getUserById(${req.params.id}) not implemented yet` });
}

async function createUser(req, res) {
  res.status(501).json({ message: 'TODO: createUser not implemented yet' });
}

async function updateUser(req, res) {
  res.status(501).json({ message: `TODO: updateUser(${req.params.id}) not implemented yet` });
}

async function deleteUser(req, res) {
  res.status(501).json({ message: `TODO: deleteUser(${req.params.id}) not implemented yet` });
}

module.exports = { listUsers, getUserById, createUser, updateUser, deleteUser };
