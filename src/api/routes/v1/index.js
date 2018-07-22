const express = require('express');
const packageService = require('../../services/package.service');

const router = express.Router();

/**
 * GET v1/status
 */
router.get('/status', (req, res) => res.send('OK'));

/**
 * GET v1/package?name=async&version=2.0.1
 */

router.get('/package',async (req,res) => {
    const {name, version} = req.query;
    await packageService.CreatePackageGraph(name,version);
    const package = await packageService.SearchPackage(name, version);
    res.json(package);
})

module.exports = router;
