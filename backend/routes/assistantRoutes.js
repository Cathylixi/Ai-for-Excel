const express = require('express');
const { parseCommand, lookupStudyTask, parseYesNo } = require('../controllers/assistantController');

const router = express.Router();

router.post('/parse-command', parseCommand);
router.post('/lookup-study-task', lookupStudyTask);
router.post('/parse-yes-no', parseYesNo);

module.exports = router;


