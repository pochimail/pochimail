import { authorize } from "@pochimail/actions/policies/authorize";
import { authorizeContract } from "@pochimail/actions/testing/policy-contract";
import { EMAIL_TYPES } from "@pochimail/classification/model/email-type";

// The safety matrix over classification's real types, so the two domains cannot drift apart.
// `authorize` treats labels as opaque: "personal" stands for whatever the composition protects.
authorizeContract(authorize, { categories: EMAIL_TYPES, protectedCategories: ["personal"] });
