/**
 * AE SAS Code Generator
 * Generate AE.sas code from Spec.datasetSlices.AE
 * Includes AE main domain and SUPPAE logic in a single file
 * Author: LLX Solutions
 */

const Study = require('../../models/studyModel');

/**
 * Generate AE.sas content
 * @param {String} studyId - Study ID
 * @returns {Promise<Object>} { filename, content }
 */
async function generateAEsas(studyId) {
  const study = await Study.findById(studyId)
    .select('studyNumber Spec.datasetSlices.AE')
    .lean();

  if (!study || !study.Spec?.datasetSlices?.AE) {
    throw new Error('AE dataset slice not found in Spec');
  }

  const aeSlice = study.Spec.datasetSlices.AE;
  const variables = aeSlice.Variables || [];
  const suppDetails = aeSlice.SUPP_Details || [];
  const studyNumber = study.studyNumber || 'UNKNOWN';

  // Extract QNAM list for IS_SUPP identification
  const qnamSet = new Set(suppDetails.map(s => s.QNAM).filter(Boolean));

  // Determine IDVAR for SUPPAE
  const idvar = suppDetails.length > 0 && suppDetails[0].IDVAR 
    ? suppDetails[0].IDVAR 
    : 'AESEQ';

  // Determine suppqual parameter
  const suppqual = suppDetails.length > 0 ? 'SUPPAE' : '';

  // Build metadata.attrib datalines
  const metadataLines = variables.map(v => {
    const dataset = v.Dataset || 'AE';
    const varName = v.Variable || '';
    const label = (v.Label || '').replace(/\|/g, ' '); // Remove pipe to avoid delimiter conflict
    const dataType = v['Data Type'] === 'Num' ? 'Num' : 'Char';
    const length = v.Length || (dataType === 'Num' ? '8' : '200');
    
    // INCLUDE='X' if Core is Req/Perm or Origin is not empty
    const include = (v.Core === 'Req' || v.Core === 'Perm' || (v.Origin && v.Origin.trim() !== '')) ? 'X' : '';
    
    // IS_SUPP='Y' if variable is in SUPP_Details QNAM list
    const isSupp = qnamSet.has(varName) ? 'Y' : 'N';

    return `${dataset}|${varName}|${label}|${dataType}|${length}|${include}|${isSupp}`;
  }).join('\n');

  // Generate current date for header
  const currentDate = new Date().toISOString().split('T')[0];

  // Build SAS code
  const sasCode = `/*********************************************************************************
Carelon Research
Project Name  : ${studyNumber}
Code Name     : ae.sas
Description   : Product AE (Adverse Events) dataset${suppDetails.length > 0 ? ' with SUPPAE' : ''}
-------------------------------------------------------------------------------------
DOCUMENTATION AND REVISION HISTORY SECTION:

Ver#  Date        Author                  Code History Description
---   -------     --------------          -------------------------
1.0   ${currentDate}  AI Generated            Auto-generated from Spec
**********************************************************************************/

%include "..\\..\\..\\..\\..\\Global\\Macros\\Global_Setup.sas";


/* Create metadata.attrib table from Spec */
data metadata.attrib;
    length DATASET $8 VARIABLE_NAME $32 LABEL $200 DATA_TYPE $8 LENGTH $8 INCLUDE $1 IS_SUPP $1;
    infile datalines delimiter='|' missover dsd;
    input DATASET $ VARIABLE_NAME $ LABEL $ DATA_TYPE $ LENGTH $ INCLUDE $ IS_SUPP $;
    datalines;
${metadataLines}
;
run;


/* Import the AE_DATA from the specification Excel file */
/* USER ACTION REQUIRED: Update the datafile path with your actual AE data file */
proc import datafile = '<UPDATE_PATH_TO_YOUR_AE_DATA_FILE.xlsx>' 
    out = work.ae0 
    dbms=xlsx replace;
    sheet = 'AE_DATA';
    getnames = yes; 
run;


/* Generate KEEPLIST for AE main domain (exclude SUPP variables) */
proc sql noprint;
    select VARIABLE_NAME into :KEEPLIST separated by ' '
    from metadata.attrib
    where upcase(DATASET)='AE' 
      and VARIABLE_NAME^='NA' 
      and upcase(INCLUDE)='X'
      and upcase(IS_SUPP)^='Y';
quit;

%put &keeplist;


/* Output the data */
data final;
    set ae0(keep=&keeplist);
    format _all_;
    informat _all_;
run;


/* Apply attributes and output to SDTM library */
/* suppqual=${suppqual ? suppqual : '<empty>'}, idvar=${suppqual ? idvar : '<empty>'} */
%mattrib4(
    dsin=final, 
    dsname=AE, 
    dsout=AE, 
    libin=work, 
    libmeta=metadata, 
    libout=sdtm, 
    suppqual=${suppqual}, 
    idvar=${suppqual ? idvar : ''}
);
`;

  return {
    filename: 'AE.sas',
    content: sasCode
  };
}

module.exports = {
  generateAEsas
};

