import axios from "axios";

const ApiService = axios.create({
  baseURL: "https://gateway-service-120280829617.asia-south1.run.app/api/content",
  withCredentials: false,
});

// ---- CASE TYPES ----
export const getCaseTypes = async () => {
  try {
    const res = await ApiService.get("/case-types");
    return res.data;
  } catch (error) {
    console.error("Error fetching case types:", error);
    throw error;
  }
};

export const getSubTypesByCaseType = async (caseTypeId) => {
  try {
    const res = await ApiService.get(`/case-types/${caseTypeId}/sub-types`);
    return res.data;
  } catch (error) {
    console.error("Error fetching sub-types:", error);
    throw error;
  }
};

// ---- COURTS ----
export const getCourts = async () => {
  try {
    const res = await ApiService.get("/courts");
    return res.data;
  } catch (error) {
    console.error("Error fetching courts:", error);
    throw error;
  }
};

export const getCourtsByLevel = async (level) => {
  try {
    const res = await ApiService.get(`/courts/level/${level}`);
    return res.data;
  } catch (error) {
    console.error("Error fetching courts by level:", error);
    throw error;
  }
};

export const getJudgesByBench = async (courtId, benchName) => {
  try {
    const res = await ApiService.get(`/judges?courtId=${courtId}&benchName=${benchName}`);
    return res.data;
  } catch (error) {
    console.error("Error fetching judges by bench:", error);
    throw error;
  }
};
