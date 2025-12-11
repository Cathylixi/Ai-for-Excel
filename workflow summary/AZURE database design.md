Cluster 0:
COMPUTATIONAL COMPLEXITY: O(log(N)+M) --> O(M)

Reference {SDTMIG_v3.4, TS sdtm_terminology;
                crf list example?
}


//chunkType: general_information; 
            protocol_information; protocol_extraction;
            crf_information; crf_crfFormList;
            crf_crfFormName; crf_Extract_words_with_position; 
            crf_Extract_rows_with_position; crf_identified_patterns;

Studies (Database){
    Study_Collection {
        {
            studyNumber; //we need this for all record in this collection
            chunkType: general_information;
            projectDone; CostEstimateDetails; Spec;traceability; createdAt; updatedAt
        } //on one record? or separate?

        {
            studyNumber;
            chunkType: protocol_information;
            uploaded;
            originalName;
            fileSize;
            mimeType;
            uploadedAt;
        }

        {
            studyNumber;
            chunkType: protocol_extraction;
            extractedText;
            sectionedText;
            tables;
            assessmentSchedule;
            endpoints;
            criterias;
            studyDesign;
            objectives;
        }

        
        {
            studyNumber;
            chunkType: crf_information;
            uploaded;
            annotationReady;
            crf_sdtm_ready_for_annotation;
            fileSize;
            mimeType;
            originalName;
            sourcePath;
            uploadedAt;
        }

        {
            studyNumber;
            chunkType: crf_crfFormList;
            formKey: "Form A"; //new variable for form name
            order: 1; //new variable for form order
            Form_A: //store the analysis result for each form
        }

        {
            studyNumber;
            chunkType: crf_crfFormList;
            formKey: "Form B"; //new variable for form name
            order: 1; //new variable for form order
            Form_B: //store the analysis result for each form
        }

        {
            studyNumber;
            chunkType: crf_crfFormName;
            crfFormName;
        }

        {
            studyNumber;
            chunkType: crf_Extract_words_with_position;
            Extract_words_with_position
        }

        {
            studyNumber;
            chunkType: crf_Extract_rows_with_position;
            Extract_rows_with_position;
        }

        {
            studyNumber;
            chunkType: crf_identified_patterns;
            identified_patterns;
        }


        sap
    };
}