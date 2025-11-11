/*********************************************************************************
Carelon Research
Project Name  : C4591036
Code Name     : ta.sas
Description   : Product ta                                                                                                                                                                                                      
-------------------------------------------------------------------------------------
DOCUMENTATION AND REVISION HISTORY SECTION:


Ver#  Date        Author                  Code History Description
---   -------     --------------          -------------------------
1.0   2025-10-15  Kun Liang               First Version
**********************************************************************************/

%include "..\..\..\..\..\Global\Macros\Global_Setup.sas";


/*Import the TA_DATA from the specification SDTM_DDS_3.4.xlsx*/
proc import datafile = '..\..\..\..\..\Global\Metadata\SDTM_DDS_3.4.xlsx' out =work.ta0 dbms=xlsx replace;
	sheet = 'TA_DATA';
	getnames = yes; 
run;

/*Output the data*/
proc sql noprint;
	select VARIABLE_NAME into :KEEPLIST separated by ' '
	from metadata.attrib
	where upcase(DATASET)='TA' and VARIABLE_NAME^='NA' and upcase(INCLUDE)='X';
quit;

%put &keeplist;

data final;
	set ta0(keep=&keeplist);
	format _all_;
	informat _all_;
run;


%mattrib4(dsin=final, dsname=TA, dsout=TA, libin=work, libmeta=metadata, libout=sdtm, suppqual=, idvar=);





